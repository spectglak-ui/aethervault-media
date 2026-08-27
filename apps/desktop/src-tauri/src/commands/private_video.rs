//! Commandes des vidéos privées (Étape 6b-i, doc §6.4 ter).
//!
//! Le sélecteur de dossier natif est réutilisé tel quel
//! (`commands::library::pick_folder`) : aucune connaissance de l'entité
//! appelante, exactement comme `pick_image`/`categoryApi.pickImage` sont
//! déjà partagés entre catégories et Titres (doc §6.6).
//!
//! Étape 6d-privé : le scan manuel génère aussi les vignettes d'aperçu
//! des vidéos privées — extraites par l'extracteur prouvé de
//! `services::episode_thumbnails` (pause=yes + seek 0 relative), encodées
//! en JPEG en mémoire puis stockées chiffrées en BLOB dans `vault.db`
//! (`private_video_files.thumbnail_blob`, migration v4) — jamais sur
//! disque en clair (§6.4 bis). La commande `private_video_thumbnail`
//! renvoie la vignette en base64 pour le frontend (même pattern que la
//! galerie d'images, §6.4 quater).
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
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    private_library_id: i64,
    path: String,
) -> Result<PrivateScanSummary, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::add_folder(
            &state.db_pool,
            active_profile_id,
            vault_state,
            private_library_id,
            state.playback_engine.handle().ok().map(|h| h.mpv_functions()),
            &path,
            &app,
        )
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
/// File Scanner public) : un catalogue privé personnel n'a pas la
/// volumétrie qui justifierait cette complexité supplémentaire.
///
/// Étape 6d-privé : transmet les fonctions libmpv au domaine pour que le
/// scan génère aussi les vignettes chiffrées des fichiers sans aperçu.
#[tauri::command]
pub fn scan_private_video_library(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    private_library_id: i64,
) -> Result<PrivateScanSummary, String> {
    let active_profile_id = state.read_active_profile_id()?;
    with_vault_state(&state, |vault_state| {
        private_video::trigger_scan(
            &state.db_pool,
            active_profile_id,
            vault_state,
            private_library_id,
            state.playback_engine.handle().ok().map(|h| h.mpv_functions()),
            &app,
        )
    })
}

/// Étape 6d-privé : vignette JPEG d'un fichier vidéo privé, encodée en
/// base64 pour le frontend (même pattern que la galerie d'images,
/// §6.4 quater) — jamais de fichier en clair sur disque.
/// vérification habituelle (profil autorisé + coffre déverrouillé) portée
/// par `domain::private_video::get_thumbnail`.
#[tauri::command]
pub fn private_video_thumbnail(
    state: tauri::State<AppState>,
    file_id: i64,
) -> Result<String, String> {
    use base64::Engine as _;
    let active_profile_id = state.read_active_profile_id()?;
    let bytes = with_vault_state(&state, |vault_state| {
        private_video::get_thumbnail(&state.db_pool, active_profile_id, vault_state, file_id)
    })?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
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