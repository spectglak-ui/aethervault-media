//! Commandes des paramètres applicatifs (Étape 7) : wrapper autour de
//! `services::metadata::tmdb` pour la section « Métadonnées en ligne ».
use crate::services::metadata::tmdb::{self, MetadataSettings};
use crate::state::AppState;

#[tauri::command]
pub fn get_metadata_settings(state: tauri::State<AppState>) -> Result<MetadataSettings, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    Ok(tmdb::load_settings(&conn))
}

#[tauri::command]
pub fn save_metadata_settings(
    state: tauri::State<AppState>,
    settings: MetadataSettings,
) -> Result<(), String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    tmdb::save_settings(&conn, &settings)
}