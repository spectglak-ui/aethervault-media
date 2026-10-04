//! Visualiseur audio (AetherFy, 0.6.0) — analyse spectrale du flux en
//! cours de lecture, diffusée vers le frontend via `visualizer-frame`.
//! Capture Symphonia (cross-platform) avec resynchronisation continue
//! sur la position mpv : le rendu suit le tempo même après un seek.

mod spectrum;
mod symphonia_cap;

pub use spectrum::VisualizerHandle;
pub use symphonia_cap::SymphoniaCapture;

use crate::services::playback_engine::PlaybackEngineHandle;
use std::sync::Arc;
use tauri::AppHandle;

/// Démarre l'analyse de la source actuellement chargée dans mpv.
/// `expected_path` : média affiché côté frontend — permet d'attendre
/// la fin de l'extraction yt-dlp (retry frontend) plutôt que de capter
/// la source du titre précédent.
pub fn start_capture(
    app_handle: AppHandle,
    engine: Arc<PlaybackEngineHandle>,
    expected_path: &str,
) -> Result<Arc<VisualizerHandle>, String> {
    let (video, audio) = engine
        .current_source()
        .ok_or_else(|| "aucune source chargée".to_string())?;
    // Flux séparés YouTube (bv* + ba) : l'audio est le 2e URL — c'est
    // LUI que Symphonia doit décoder (le flux vidéo ne contient aucun
    // échantillon audio). Flux audio-only ou fichier local : le 1er.
    let source = audio.unwrap_or(video);
    let origin = engine.current_origin();
    let matches = source == expected_path || origin.as_deref() == Some(expected_path);
    if !matches {
        log::warn!(
            "[visualizer] source non appairée : attendu={expected_path} source={source} origin={origin:?}"
        );
        return Err("source audio pas encore prête".to_string());
    }
    let start_position = engine.current_position();
    SymphoniaCapture::spawn(app_handle, engine, source, start_position)
}

/// Arrête la capture en cours (s'il y en a une).
pub fn stop_capture(handle: &Arc<VisualizerHandle>) {
    handle.stop();
}