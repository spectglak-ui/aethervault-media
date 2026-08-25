//! Commandes des vidéos privées (Étape 6b-i, doc §6.4 ter).
//!
//! Le sélecteur de dossier natif est réutilisé tel quel
//! (`commands::library::pick_folder`) : aucune connaissance de l'entité
//! appelante, exactement comme `pick_image`/`categoryApi.pickImage` sont
//! déjà partagés entre catégories et Titres (doc §6.6).

use crate::db::repositories::private_video_repository::{PrivatePlaybackProgressRecord, PrivateVideoFileRecord};
use crate::domain::private_video::{self, PrivateVideoFolderSummary};
use crate::security::vault::VaultState;
use crate::services::private_video_scanner::PrivateScanSummary;
use crate::state::AppState;

fn with_vault_state<T>(
    state: &tauri::State<AppState>,
    f: impl FnOnce(&VaultState) -> Result<T, String>,
) -> Result<T, String> {
    let vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    f(&vault_guard)
}

#[tauri::command]
pub fn list_private_video_folders(
    state: tauri::State<AppState>,
    private_library_id: i64,
) -> Result<Vec<PrivateVideoFolderSummary>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::list_folders(&state.db_pool, active_profile_id, vault_state, private_library_id)
    })
}

#[tauri::command]
pub fn add_private_video_folder(
    state: tauri::State<AppState>,
    private_library_id: i64,
    path: String,
) -> Result<PrivateScanSummary, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::add_folder(&state.db_pool, active_profile_id, vault_state, private_library_id, &path)
    })
}

#[tauri::command]
pub fn remove_private_video_folder(state: tauri::State<AppState>, folder_id: i64) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::remove_folder(&state.db_pool, active_profile_id, vault_state, folder_id)
    })
}

#[tauri::command]
pub fn list_private_video_files(
    state: tauri::State<AppState>,
    private_library_id: i64,
) -> Result<Vec<PrivateVideoFileRecord>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::list_files(&state.db_pool, active_profile_id, vault_state, private_library_id)
    })
}

/// Scan manuel — pas de surveillance continue pour cette première version
/// (doc §6.4 ter). Synchrone (pas d'événements de progression comme le
/// scanner public) : un catalogue privé personnel n'a pas la volumétrie
/// qui justifierait cette complexité supplémentaire.
#[tauri::command]
pub fn scan_private_video_library(
    state: tauri::State<AppState>,
    private_library_id: i64,
) -> Result<PrivateScanSummary, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::trigger_scan(&state.db_pool, active_profile_id, vault_state, private_library_id)
    })
}

#[tauri::command]
pub fn get_private_playback_progress(
    state: tauri::State<AppState>,
    media_file_id: i64,
) -> Result<Option<PrivatePlaybackProgressRecord>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::get_playback_progress(&state.db_pool, active_profile_id, vault_state, media_file_id)
    })
}

#[tauri::command]
pub fn save_private_playback_progress(
    state: tauri::State<AppState>,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::save_playback_progress(
            &state.db_pool,
            active_profile_id,
            vault_state,
            media_file_id,
            position_seconds,
            duration_seconds,
        )
    })
}
