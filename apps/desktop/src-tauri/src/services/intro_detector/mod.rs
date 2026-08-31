//! Détection automatique des génériques (0.3.0) — Option A :
//! empreintes **Chromaprint** calculées par le binaire externe `fpcalc`
//! (le même socle qu'utilise IntroSkipper/Jellyfin), comparées ENTRE
//! épisodes d'une même série en Rust : séquences audio identiques en
//! début d'épisode = intro, en fin = outro.
//!
//! Repli automatique : si `fpcalc` est absent ou échoue, on retombe sur
//! le décodeur Symphonia + empreinte maison (FFT + bits différentiels).
//!
//! Les résumés (« previously ») ont un audio différent à chaque épisode
//! → non détectables automatiquement → marquage manuel uniquement.
use rustfft::num_complex::Complex;
use rustfft::FftPlanner;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Trames par seconde de l'empreinte maison (repli Symphonia uniquement).
pub const FPS: f64 = 11025.0 / 1024.0;
const FFT_SIZE: usize = 4096;
const HOP: usize = 1024;
const TARGET_RATE: u32 = 11025;
const BANDS: usize = 33;
const ZONE_SECONDS: f64 = 360.0;
const MIN_RUN_SECONDS: f64 = 15.0;
const MAX_RUN_SECONDS: f64 = 240.0;
const MAX_BER_BITS: u32 = 12;

#[derive(Clone)]
pub struct ZoneFingerprint {
    pub head: Vec<u32>,
    pub head_active: Vec<bool>,
    pub tail: Vec<u32>,
    pub tail_active: Vec<bool>,
    pub duration_seconds: f64,
    /// Trames par seconde de CETTE empreinte (fpcalc ≈ 8, maison ≈ 10.77).
    pub fps: f64,
}

/// Résout l'emplacement de fpcalc : FPCALC_PATH → à côté de l'exe →
/// sous-dossier resources → répertoire courant (dev : src-tauri).
fn fpcalc_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("FPCALC_PATH") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            dirs.push(dir.join("resources"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd);
    }
    for dir in dirs {
        for name in ["fpcalc.exe", "fpcalc"] {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Empreinte Chromaprint du fichier entier via fpcalc, découpée en zones
/// tête/queue. fpcalc embarque son propre décodage (FFmpeg) : gère tous
/// les codecs/conteneurs, bien plus robuste que Symphonia.
fn fingerprint_with_fpcalc(path: &Path, fpcalc: &Path) -> Option<ZoneFingerprint> {
    log::info!("[fingerprint] fpcalc sur {}", path.display());
    let output = std::process::Command::new(fpcalc)
        .args(["-json", "-raw", "-length", "0"])
        .arg(path)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW : pas de flash console
        .output()
        .ok()?;
    if !output.status.success() {
        log::warn!(
            "[fingerprint] fpcalc en échec sur {} : {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let duration = json.get("duration")?.as_f64()?;
    let frames: Vec<u32> = json
        .get("fingerprint")?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_u64().map(|x| x as u32))
        .collect();
    if frames.is_empty() || duration <= 1.0 {
        log::warn!("[fingerprint] fpcalc : empreinte vide pour {}", path.display());
        return None;
    }
    let fps = frames.len() as f64 / duration;
    let zone = (ZONE_SECONDS * fps) as usize;
    let head_end = zone.min(frames.len());
    let tail_start = frames.len().saturating_sub(zone);
    let head = frames[..head_end].to_vec();
    let tail = frames[tail_start..].to_vec();
    log::info!(
        "[fingerprint] fpcalc {} : {} trames, durée {:.1}s, fps {:.2}",
        path.display(),
        frames.len(),
        duration,
        fps
    );
    Some(ZoneFingerprint {
        head_active: vec![true; head.len()],
        tail_active: vec![true; tail.len()],
        head,
        tail,
        duration_seconds: duration,
        fps,
    })
}

/// Point d'entrée : fpcalc d'abord (Option A), repli Symphonia (Option B).
pub fn fingerprint_file(path: &Path) -> Option<ZoneFingerprint> {
    if let Some(fpcalc) = fpcalc_path() {
        if let Some(fp) = fingerprint_with_fpcalc(path, &fpcalc) {
            return Some(fp);
        }
        log::warn!("[fingerprint] repli Symphonia pour {}", path.display());
    } else {
        log::info!("[fingerprint] fpcalc introuvable — empreinte maison (Symphonia)");
    }
    fingerprint_with_symphonia(path)
}

/// Repli : décodeur Symphonia + empreinte maison.
fn fingerprint_with_symphonia(path: &Path) -> Option<ZoneFingerprint> {
    log::info!("[fingerprint] symphonia : ouverture de {}", path.display());
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            log::error!("[fingerprint] impossible d'ouvrir {} : {:?}", path.display(), e);
            return None;
        }
    };
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = match symphonia::default::get_probe().format(
        &Hint::default(),
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[fingerprint] format non reconnu pour {} : {:?}", path.display(), e);
            return None;
        }
    };
    let mut container = probed.format;
    let mut decoder_opt = None;
    let mut selected_track_id = 0;
    for track in container.tracks() {
        if let Ok(dec) = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
        {
            decoder_opt = Some(dec);
            selected_track_id = track.id;
            break;
        }
    }
    let mut decoder = match decoder_opt {
        Some(d) => d,
        None => {
            log::warn!("[fingerprint] aucune piste audio décodable dans {}", path.display());
            return None;
        }
    };
    let mut real_rate = decoder.codec_params().sample_rate.unwrap_or(48000);
    let mut zone_cap = (ZONE_SECONDS * real_rate as f64) as usize;
    let mut rate_known = decoder.codec_params().sample_rate.is_some();
    let mut head: Vec<i16> = Vec::new();
    let mut tail: std::collections::VecDeque<i16> = std::collections::VecDeque::new();
    let mut total: u64 = 0;
    loop {
        let packet = match container.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != selected_track_id {
            continue;
        }
        let buf = match decoder.decode(&packet) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let frames = buf.frames();
        if frames == 0 {
            continue;
        }
        let spec = buf.spec();
        if !rate_known {
            real_rate = spec.rate;
            rate_known = true;
            zone_cap = (ZONE_SECONDS * real_rate as f64) as usize;
        }
        let n_channels = spec.channels.count().max(1);
        let mut sb = SampleBuffer::<f32>::new(frames as u64, *spec);
        sb.copy_interleaved_ref(buf);
        for frame in sb.samples().chunks(n_channels) {
            let mut sum: f32 = 0.0;
            for s in frame {
                sum += *s;
            }
            let mono = (sum / n_channels as f32).clamp(-1.0, 1.0);
            let s16 = (mono * 32767.0) as i16;
            total += 1;
            if head.len() < zone_cap {
                head.push(s16);
            }
            tail.push_back(s16);
            if tail.len() > zone_cap {
                tail.pop_front();
            }
        }
    }
    if total == 0 {
        log::warn!("[fingerprint] {} : aucune trame audio décodée", path.display());
        return None;
    }
    let head_f32: Vec<f32> = resample(&head, real_rate, TARGET_RATE)
        .into_iter()
        .map(|v| v as f32 / 32767.0)
        .collect();
    let tail_vec: Vec<i16> = tail.into();
    let tail_f32: Vec<f32> = resample(&tail_vec, real_rate, TARGET_RATE)
        .into_iter()
        .map(|v| v as f32 / 32767.0)
        .collect();
    let (head_fp, head_active) = fingerprint(&head_f32);
    let (tail_fp, tail_active) = fingerprint(&tail_f32);
    Some(ZoneFingerprint {
        head: head_fp,
        head_active,
        tail: tail_fp,
        tail_active,
        duration_seconds: total as f64 / real_rate as f64,
        fps: FPS,
    })
}

fn resample(input: &[i16], from: u32, to: u32) -> Vec<i16> {
    if from == to {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = (input.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for j in 0..out_len {
        let p = j as f64 * ratio;
        let idx = p as usize;
        let t = p - idx as f64;
        let a = input[idx] as f64;
        let b = input.get(idx + 1).copied().unwrap_or(input[idx]) as f64;
        out.push((a * (1.0 - t) + b * t) as i16);
    }
    out
}

/// Empreinte maison (repli Symphonia uniquement) : FFT 4096, hop 1024,
/// 33 bandes log, 32 bits différentiels par trame.
fn fingerprint(mono: &[f32]) -> (Vec<u32>, Vec<bool>) {
    if mono.len() < FFT_SIZE {
        return (Vec::new(), Vec::new());
    }
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let mut window = vec![0.0f32; FFT_SIZE];
    for (i, w) in window.iter_mut().enumerate() {
        *w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos());
    }
    let bin_hz = TARGET_RATE as f64 / FFT_SIZE as f64;
    let mut edges = vec![0usize; BANDS + 1];
    for (i, e) in edges.iter_mut().enumerate() {
        let f: f64 = 250.0 * (5000.0_f64 / 250.0_f64).powf(i as f64 / BANDS as f64);
        *e = (f / bin_hz) as usize;
    }
    edges[0] = 1;
    let frame_count = (mono.len().saturating_sub(FFT_SIZE)) / HOP + 1;
    let mut energies: Vec<[f32; BANDS]> = Vec::with_capacity(frame_count);
    let mut actives: Vec<bool> = Vec::with_capacity(frame_count);
    let mut scratch = vec![Complex::new(0.0f32, 0.0); FFT_SIZE];
    for t in 0..frame_count {
        let base = t * HOP;
        for (i, s) in scratch.iter_mut().enumerate() {
            s.re = mono[base + i] * window[i];
            s.im = 0.0;
        }
        fft.process(&mut scratch);
        let mut band_e = [0.0f32; BANDS];
        let mut total = 0.0f32;
        for (b, e) in band_e.iter_mut().enumerate() {
            let lo = edges[b];
            let hi = edges[b + 1].max(lo + 1);
            let mut acc = 0.0f32;
            for k in lo..hi.min(FFT_SIZE / 2) {
                acc += scratch[k].norm();
            }
            *e = acc;
            total += acc;
        }
        energies.push(band_e);
        actives.push(total > 1.0);
    }
    let mut frames = Vec::with_capacity(energies.len().saturating_sub(1));
    for t in 0..energies.len().saturating_sub(1) {
        let (cur, nxt) = (&energies[t], &energies[t + 1]);
        let mut hash: u32 = 0;
        for k in 0..BANDS - 1 {
            let d1 = cur[k] - cur[k + 1];
            let d2 = nxt[k] - nxt[k + 1];
            if d1 > d2 {
                hash |= 1 << k;
            }
        }
        frames.push(hash);
    }
    let act: Vec<bool> = actives
        .iter()
        .zip(actives.iter().skip(1))
        .map(|(a, b)| *a && *b)
        .collect();
    (frames, act)
}

/// Meilleure zone commune entre deux empreintes — tolère des trous
/// jusqu'à ~2 s consécutives. Segment valide si durée ≥ MIN_RUN_SECONDS
/// et densité ≥ 50 %.
fn best_run(
    a: &[u32],
    a_act: &[bool],
    b: &[u32],
    b_act: &[bool],
    off_min: i64,
    off_max: i64,
    fps: f64,
    context: &str,
) -> Option<(usize, usize, usize)> {
    let min_len = (MIN_RUN_SECONDS * fps) as usize;
    let max_len = (MAX_RUN_SECONDS * fps) as usize;
    let max_gap = (2.0 * fps) as usize;
    let mut best: Option<(usize, usize, usize, f32)> = None;
    for off in (off_min..=off_max).step_by(2) {
        let (mut ai, mut bi) = if off >= 0 {
            (0usize, off as usize)
        } else {
            ((-off) as usize, 0usize)
        };
        let mut run_start: usize = 0;
        let mut run_len: usize = 0;
        let mut run_matched: usize = 0;
        let mut gap: usize = 0;
        let mut in_run = false;
        while ai < a.len() && bi < b.len() {
            let ok = a_act[ai] && b_act[bi] && (a[ai] ^ b[bi]).count_ones() <= MAX_BER_BITS;
            if ok {
                if !in_run {
                    run_start = ai;
                    run_len = 1;
                    run_matched = 1;
                    gap = 0;
                    in_run = true;
                } else {
                    gap = 0;
                    run_matched += 1;
                    run_len += 1;
                }
            } else if in_run {
                gap += 1;
                run_len += 1;
                if gap > max_gap {
                    let valid_len = run_len.saturating_sub(gap).max(1);
                    let len = valid_len.min(max_len);
                    let density = run_matched as f32 / valid_len as f32;
                    if len >= min_len && density >= 0.5 {
                        let cand = (run_start, (run_start as i64 + off) as usize, len, density);
                        let better = match best {
                            Some((_, _, pl, pd)) => len > pl || (len == pl && density > pd),
                            None => true,
                        };
                        if better {
                            best = Some(cand);
                        }
                    }
                    in_run = false;
                }
            }
            ai += 1;
            bi += 1;
        }
        if in_run {
            let valid_len = run_len.saturating_sub(gap).max(1);
            let len = valid_len.min(max_len);
            let density = run_matched as f32 / valid_len as f32;
            if len >= min_len && density >= 0.5 {
                let cand = (run_start, (run_start as i64 + off) as usize, len, density);
                let better = match best {
                    Some((_, _, pl, pd)) => len > pl || (len == pl && density > pd),
                    None => true,
                };
                if better {
                    best = Some(cand);
                }
            }
        }
    }
    if let Some((sa, sb, len, density)) = best {
        log::info!(
            "[credits] {} : segment trouvé — {} trames ({:.1}s), densité {:.0}%",
            context,
            len,
            len as f64 / fps,
            density * 100.0
        );
        Some((sa, sb, len))
    } else {
        log::info!("[credits] {} : aucun segment valide", context);
        None
    }
}

/// Détection sur une série : paires d'épisodes consécutifs, zones tête
/// (intro) et queue (outro). Renvoie (episode_id, type, start, end).
pub fn detect_series(
    episodes: &[(i64, String)],
    mut on_progress: impl FnMut(usize, usize, String),
) -> Vec<(i64, &'static str, f64, f64)> {
    let mut fps_vec: Vec<Option<ZoneFingerprint>> = vec![None; episodes.len()];
    let mut intro: std::collections::HashMap<i64, (u32, f64, f64)> =
        std::collections::HashMap::new();
    let mut outro: std::collections::HashMap<i64, (u32, f64, f64)> =
        std::collections::HashMap::new();
    for i in 0..episodes.len() {
        on_progress(i, episodes.len(), episodes[i].1.clone());
        if fps_vec[i].is_none() {
            fps_vec[i] = fingerprint_file(Path::new(&episodes[i].1));
        }
        let j = i + 1;
        if j >= episodes.len() {
            continue;
        }
        if fps_vec[j].is_none() {
            fps_vec[j] = fingerprint_file(Path::new(&episodes[j].1));
        }
        let (fa, fb) = match (fps_vec[i].as_ref(), fps_vec[j].as_ref()) {
            (Some(a), Some(b)) => (a, b),
            _ => continue,
        };
        // On ne compare que des empreintes de même source (même fps).
        if (fa.fps - fb.fps).abs() > 0.5 {
            continue;
        }
        let fps = fa.fps;
        let zone_frames = (ZONE_SECONDS * fps) as i64;
        let (ida, idb) = (episodes[i].0, episodes[j].0);
        if let Some((sa, sb, len)) = best_run(
            &fa.head,
            &fa.head_active,
            &fb.head,
            &fb.head_active,
            -zone_frames,
            zone_frames,
            fps,
            &format!("intro E{}-E{}", ida, idb),
        ) {
            let la = sa as f64 / fps;
            let lb = sb as f64 / fps;
            let l = len as f64 / fps;
            intro.entry(ida).and_modify(|e| e.0 += 1).or_insert((1, la, la + l));
            intro.entry(idb).and_modify(|e| e.0 += 1).or_insert((1, lb, lb + l));
        }
        if let Some((sa, sb, len)) = best_run(
            &fa.tail,
            &fa.tail_active,
            &fb.tail,
            &fb.tail_active,
            -zone_frames,
            zone_frames,
            fps,
            &format!("outro E{}-E{}", ida, idb),
        ) {
            let l = len as f64 / fps;
            let start_a = fa.duration_seconds - fa.tail.len() as f64 / fps + sa as f64 / fps;
            let start_b = fb.duration_seconds - fb.tail.len() as f64 / fps + sb as f64 / fps;
            outro.entry(ida).and_modify(|e| e.0 += 1).or_insert((1, start_a, start_a + l));
            outro.entry(idb).and_modify(|e| e.0 += 1).or_insert((1, start_b, start_b + l));
        }
    }
    let mut out = Vec::new();
    for (id, (_, s, e)) in intro {
        out.push((id, "intro", s, e));
    }
    for (id, (_, s, e)) in outro {
        out.push((id, "outro", s, e));
    }
    out
}