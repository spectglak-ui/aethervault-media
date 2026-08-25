//! Commandes des images privées (Étape 6b-ii, doc §6.4 quater).
//!
//! Seul endroit du projet qui encode des octets en base64 : c'est ici, à
//! la frontière IPC, que le choix "commande dédiée renvoyant les octets"
//! (doc §6.4 quater) prend forme concrètement — jamais dans
//! `domain::private_image` ni dans les repositories, qui manipulent des
//! `Vec<u8>` bruts.

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::db::repositories::private_image_repository::{PrivateImageFileRecord, PrivateImageFolderRecord};
use crate::domain::private_image;
use crate::security::vault::VaultState;
use crate::services::private_image_scanner::PrivateImageScanSummary;
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
pub fn list_private_image_folders(
    state: tauri::State<AppState>,
    private_library_id: i64,
) -> Result<Vec<PrivateImageFolderRecord>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_image::list_folders(&state.db_pool, active_profile_id, vault_state, private_library_id)
    })
}

#[tauri::command]
pub fn add_private_image_folder(
    state: tauri::State<AppState>,
    private_library_id: i64,
    path: String,
) -> Result<PrivateImageScanSummary, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_image::add_folder(&state.db_pool, active_profile_id, vault_state, private_library_id, &path)
    })
}

#[tauri::command]
pub fn remove_private_image_folder(state: tauri::State<AppState>, folder_id: i64) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_image::remove_folder(&state.db_pool, active_profile_id, vault_state, folder_id)
    })
}

/// Scan manuel — pas de surveillance continue pour cette version (doc
/// §6.4 ter/quater). Synchrone : le mutex du coffre reste retenu pour
/// toute la durée (décodage + redimensionnement + encodage de chaque
/// image a un coût CPU réel, contrairement au scan vidéo).
#[tauri::command]
pub fn scan_private_image_library(
    state: tauri::State<AppState>,
    private_library_id: i64,
) -> Result<PrivateImageScanSummary, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_image::trigger_scan(&state.db_pool, active_profile_id, vault_state, private_library_id)
    })
}

#[tauri::command]
pub fn list_private_image_files(
    state: tauri::State<AppState>,
    folder_id: i64,
) -> Result<Vec<PrivateImageFileRecord>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_image::list_files(&state.db_pool, active_profile_id, vault_state, folder_id)
    })
}

/// Renvoie la vignette encodée en base64 (`None` si absente — décodage
/// échoué au scan, ou fichier pas encore scanné). Le frontend construit
/// directement une URI `data:image/jpeg;base64,...` (doc §6.4 quater).
#[tauri::command]
pub fn get_private_image_thumbnail(state: tauri::State<AppState>, file_id: i64) -> Result<Option<String>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let bytes = with_vault_state(&state, |vault_state| {
        private_image::get_thumbnail(&state.db_pool, active_profile_id, vault_state, file_id)
    })?;
    Ok(bytes.map(|b| STANDARD.encode(b)))
}

#[tauri::command]
pub fn get_private_album_cover(state: tauri::State<AppState>, folder_id: i64) -> Result<Option<String>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let bytes = with_vault_state(&state, |vault_state| {
        private_image::get_album_cover(&state.db_pool, active_profile_id, vault_state, folder_id)
    })?;
    Ok(bytes.map(|b| STANDARD.encode(b)))
}

/// `file_id: None` réinitialise à la couverture par défaut.
#[tauri::command]
pub fn set_private_album_cover(
    state: tauri::State<AppState>,
    folder_id: i64,
    file_id: Option<i64>,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_image::set_album_cover(&state.db_pool, active_profile_id, vault_state, folder_id, file_id)
    })
}
