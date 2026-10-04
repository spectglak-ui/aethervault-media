//! FFT + réduction en bandes logarithmiques + détection de pulse (kick).
//! Sortie : ~30 fps, ~200 o/event, prête à être émise en Tauri.

use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

/// Taille de fenêtre FFT — 2048 samples à 48 kHz ≈ 42 ms, bon compromis
/// résolution fréquentielle / réactivité temporelle.
pub const FFT_SIZE: usize = 2048;
pub const SAMPLE_RATE: usize = 48000;
pub const BANDS: usize = 24; // bandes log envoyées au frontend

#[derive(Clone, serde::Serialize)]
pub struct SpectrumFrame {
    pub bands: Vec<f32>,   // BANDS valeurs normalisées 0..1
    pub bass: f32,         // moyenne basses (40-250 Hz)
    pub mid: f32,          // moyenne médiums (250-2000 Hz)
    pub treble: f32,       // moyenne aigus (2-16 kHz)
    pub pulse: f32,        // intensité du "kick" détecté (0..1)
}

pub struct VisualizerHandle {
    stop: AtomicBool,
    /// Timestamp du dernier frame émis (ms depuis UNIX) — permet au
    /// frontend de détecter une capture figée.
    pub last_frame_ts: AtomicU64,
}

impl VisualizerHandle {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            stop: AtomicBool::new(false),
            last_frame_ts: AtomicU64::new(0),
        })
    }
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
    pub fn is_stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }
}

/// Applique une fenêtre de Hann au buffer avant FFT — réduit les fuites
/// spectrales sur les bords.
fn apply_hann(buf: &mut [f32]) {
    let n = buf.len() as f32;
    for (i, v) in buf.iter_mut().enumerate() {
        let w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / n).cos());
        *v *= w;
    }
}

/// Réduit un spectre normalisé (0..1 par bin) en BANDS bandes log.
pub fn reduce_to_bands(magnitudes: &[f32]) -> SpectrumFrame {
    let n = magnitudes.len().max(1) as f32;
    let mut bands = vec![0.0f32; BANDS];
    let log_min = 40.0f32.ln();
    let log_max = 16000.0f32.ln();
    // 20 000 Hz = haut du spectre utile, quelle que soit la fréquence
    // d'échantillonnage (les bins sont exprimés en fraction de Nyquist).
    for b in 0..BANDS {
        let f_lo = (log_min + (log_max - log_min) * (b as f32 / BANDS as f32)).exp();
        let f_hi = (log_min + (log_max - log_min) * ((b + 1) as f32 / BANDS as f32)).exp();
        let lo = ((f_lo / 20000.0) * n) as usize;
        let hi = ((f_hi / 20000.0) * n) as usize;
        let lo = lo.min(magnitudes.len() - 1);
        let hi = hi.max(lo + 1).min(magnitudes.len());
        let sum: f32 = magnitudes[lo..hi].iter().sum();
        let avg = sum / (hi - lo) as f32;
        bands[b] = avg.powf(0.55).min(1.0); // courbe perceptuelle
    }
    let bass = avg_slice(&bands[..3]);
    let mid = avg_slice(&bands[3..10]);
    let treble = avg_slice(&bands[10..]);
    SpectrumFrame {
        bands,
        bass,
        mid,
        treble,
        pulse: 0.0,
    }
}

fn avg_slice(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    s.iter().sum::<f32>() / s.len() as f32
}

/// Crée un planificateur FFT réutilisable (coût initial ~1 ms, ensuite O(n log n)).
pub fn make_fft() -> Arc<dyn rustfft::Fft<f32>> {
    let mut planner = FftPlanner::new();
    planner.plan_fft_forward(FFT_SIZE)
}

pub fn do_fft(fft: &dyn rustfft::Fft<f32>, samples: &[f32]) -> Vec<f32> {
    let mut buf: Vec<Complex<f32>> = samples.iter().map(|&s| Complex::new(s, 0.0)).collect();
    let mut scratch = vec![Complex::new(0.0, 0.0); fft.get_inplace_scratch_len()];
    fft.process_with_scratch(&mut buf, &mut scratch);
    // magnitudes (moitié du spectre — la seconde moitié est miroir)
    buf.iter().take(FFT_SIZE / 2).map(|c| c.norm()).collect()
}

pub fn apply_hann_to(samples: &mut [f32]) {
    apply_hann(samples);
}