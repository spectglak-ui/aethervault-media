//! Capture Symphonia : décodage parallèle de la source chargée dans mpv,
//! resynchronisé en continu sur `time-pos` (le rendu suit le tempo même
//! après un seek). Auto-gain : le pic spectral courant normalise la FFT,
//! sinon la dynamique visuelle dépendrait du volume master du titre.

use super::spectrum::*;
use crate::services::playback_engine::PlaybackEngineHandle;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream, ReadOnlySource};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;
use tauri::{AppHandle, Emitter};

pub struct SymphoniaCapture;

impl SymphoniaCapture {
    pub fn spawn(
        app_handle: AppHandle,
        engine: Arc<PlaybackEngineHandle>,
        source_path: String,
        start_position: f64,
    ) -> Result<Arc<VisualizerHandle>, String> {
        let handle = VisualizerHandle::new();
        let h = handle.clone();
        std::thread::Builder::new()
            .name("visualizer-symphonia".into())
            .spawn(move || {
                if let Err(e) = Self::run(app_handle, engine, h.clone(), source_path, start_position) {
                    log::warn!("[visualizer] capture terminée : {e}");
                }
            })
            .map_err(|e| format!("spawn visualizer : {e}"))?;
        Ok(handle)
    }

    fn run(
        app_handle: AppHandle,
        engine: Arc<PlaybackEngineHandle>,
        handle: Arc<VisualizerHandle>,
        source_path: String,
        start_position: f64,
    ) -> Result<(), String> {
        let source: Box<dyn std::io::Read + Send + Sync> =
            if source_path.starts_with("http://") || source_path.starts_with("https://") {
                Box::new(
                    ureq::get(&source_path)
                        .timeout(std::time::Duration::from_secs(15))
                        .call()
                        .map_err(|e| format!("HTTP {e}"))?
                        .into_reader(),
                )
            } else {
                Box::new(
                    std::fs::File::open(&source_path)
                        .map_err(|e| format!("open {source_path} : {e}"))?,
                )
            };

        let mss = MediaSourceStream::new(Box::new(ReadOnlySource::new(source)), Default::default());
        let seekable = mss.is_seekable();
        let mut hint = Hint::new();
        if let Some(ext) = std::path::Path::new(&source_path).extension().and_then(|s| s.to_str()) {
            hint.with_extension(ext);
        }
        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
            .map_err(|e| format!("probe : {e}"))?;
        let mut format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
            .ok_or_else(|| "aucune piste audio".to_string())?;
        let track_id = track.id;
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("decoder : {e}"))?;
        let sample_rate = track.codec_params.sample_rate.unwrap_or(SAMPLE_RATE as u32) as f64;
        let channels = track
            .codec_params
            .channels
            .unwrap_or(symphonia::core::audio::Channels::FRONT_LEFT)
            .count();

        let fft = make_fft();
        let mut ring: Vec<f32> = Vec::with_capacity(FFT_SIZE * 2);
        let mut peak: f32 = 1e-4; // auto-gain
        let mut last_bass: f32 = 0.0;
        let mut pulse: f32 = 0.0;
        let mut decoded_secs: f64 = 0.0;
        let mut catchup_until: f64 = start_position; // rattrapage initial
        let mut last_resync = std::time::Instant::now();
        let frame_interval = std::time::Duration::from_millis(33);
        let mut last_emit = std::time::Instant::now();

        loop {
            if handle.is_stopped() {
                log::info!("[visualizer] arrêt demandé");
                break;
            }
            let packet = match format.next_packet() {
                Ok(p) => p,
                Err(symphonia::core::errors::Error::ResetRequired) => continue,
                Err(symphonia::core::errors::Error::IoError(e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(e) => {
                    log::debug!("[visualizer] next_packet : {e}");
                    break;
                }
            };
            if packet.track_id() != track_id {
                continue;
            }
            let decoded = match decoder.decode(&packet) {
                Ok(d) => d,
                Err(_) => continue,
            };
            decoded_secs += decoded.frames() as f64 / sample_rate;

            // Resync périodique sur mpv (seek si possible, catch-up sinon).
            if last_resync.elapsed() >= std::time::Duration::from_secs(4) {
                last_resync = std::time::Instant::now();
                let pos = engine.current_position();
                let drift = decoded_secs - pos;
                if drift < -0.6 {
                    if seekable {
                        let secs = pos.floor() as u64;
                        let _ = format.seek(
                            SeekMode::Coarse,
                            SeekTo::Time {
                                time: Time::new(secs, pos - secs as f64),
                                track_id: Some(track_id),
                            },
                        );
                        decoded_secs = pos;
                        ring.clear();
                    } else {
                        catchup_until = pos; // décode sans émettre
                    }
                } else if drift > 1.0 && seekable {
                    let secs = pos.floor() as u64;
                    let _ = format.seek(
                        SeekMode::Coarse,
                        SeekTo::Time {
                            time: Time::new(secs, pos - secs as f64),
                            track_id: Some(track_id),
                        },
                    );
                    decoded_secs = pos;
                    ring.clear();
                }
            }

            // Phase muette : rattrapage jusqu'à la position mpv.
            if decoded_secs < catchup_until {
                continue;
            }

            let spec = *decoded.spec();
            let mut sbuf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
            sbuf.copy_interleaved_ref(decoded);
            if channels >= 2 {
                for ch in sbuf.samples().chunks(channels) {
                    if let [l, r, ..] = ch {
                        ring.push((l + r) * 0.5);
                    }
                }
            } else {
                ring.extend(sbuf.samples().iter().copied());
            }
            if ring.len() > FFT_SIZE * 4 {
                let drop = ring.len() - FFT_SIZE * 2;
                ring.drain(..drop);
            }
            if ring.len() < FFT_SIZE || last_emit.elapsed() < frame_interval {
                continue;
            }

            let mut window: Vec<f32> = ring[ring.len() - FFT_SIZE..].to_vec();
            apply_hann_to(&mut window);
            let mags = do_fft(fft.as_ref(), &window);

            // Auto-gain : pic courant avec décroissance lente.
            let m = mags.iter().copied().fold(0.0f32, f32::max);
            peak = m.max(peak * 0.996).max(1e-4);
            let norm: Vec<f32> = mags.iter().map(|v| (v / peak).min(1.0)).collect();
            let mut frame = reduce_to_bands(&norm);

            if frame.bass > last_bass + 0.10 && frame.bass > 0.40 {
                pulse = 1.0;
            } else {
                pulse = (pulse * 0.90).max(0.0);
            }
            last_bass = last_bass * 0.85 + frame.bass * 0.15;
            frame.pulse = pulse;

            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            handle.last_frame_ts.store(now_ms, Ordering::Relaxed);
            let _ = app_handle.emit("visualizer-frame", &frame);
            last_emit = std::time::Instant::now();
        }
        Ok(())
    }
}