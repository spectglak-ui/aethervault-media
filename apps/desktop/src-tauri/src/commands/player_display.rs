//! Mode d'affichage du lecteur (0.7.9) — voir `services::playback_engine::display_mode`.

use crate::services::playback_engine::display_mode::DisplayMode;
use crate::state::AppState;

/// Applique un mode d'affichage (`contain` | `cover` | `stretch` | `original`).
/// Le frontend transmet la géométrie qu'il connaît : taille de l'image rendue
/// (le canvas) et taille réelle, en pixels physiques, de la zone d'affichage.
/// À rappeler quand elle change (redimensionnement, échelle de rendu) et à la
/// première image de chaque média.
#[tauri::command]
pub fn player_set_display_mode(
    state: tauri::State<AppState>,
    mode: String,
    buffer_width: u32,
    buffer_height: u32,
    physical_width: u32,
    physical_height: u32,
) -> Result<(), String> {
    let mode = DisplayMode::parse(&mode).ok_or_else(|| format!("Mode d'affichage inconnu : {mode}"))?;
    state.playback_engine.handle()?.apply_display_mode(
        mode,
        (buffer_width as f64, buffer_height as f64),
        (physical_width as f64, physical_height as f64),
    )
}
