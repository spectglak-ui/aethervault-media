//! Vidéos privées (Étape 6b-i, doc §6.4 ter).
//!
//! Même double vérification que le reste du Privacy/Security Manager
//! (`domain::privacy`) à chaque fonction : coffre déverrouillé **et**
//! profil actif autorisé (`can_access_private`) — réutilise directement
//! `domain::privacy::require_private_access` / `require_unlocked_connection`
//! plutôt que de dupliquer ce critère.
//!
//! Stratégie de persistance différenciée (doc §6.4 bis) :
//! - dossiers (ajout/suppression) et scan : opérations peu fréquentes,
//!   persistées immédiatement (une fois à la fin du scan, jamais fichier
//!   par fichier — voir `services::private_video_scanner`) ;
//! - progression de lecture : mise à jour toutes les 5 secondes pendant la
//!   lecture, jamais persistée à chaque tick — seulement à la fin
//!   d'un visionnage (marqué terminé) et au verrouillage du coffre
//!   (`commands::security::lock_vault`).
//!
//! Étape 6d-privé : vignettes d'aperçu des vidéos privées, générées au
//! scan (comme le catalogue public) mais stockées CHIFFRÉES en BLOB dans
//! `vault.db` (`thumbnail_blob`, migration v4) — jamais sur disque en
//! clair, conformément à l'exception déjà posée en §6.4 bis pour les
//! vignettes du coffre. Génération best-effort : un fichier pathologique
//! est compté en échec et n'interrompt ni le scan ni les autres fichiers.
use crate::db::repositories::private_repository;
use crate::db::repositories::private_video_repository::{
    self, PrivatePlaybackProgressRecord, PrivateVideoFileRecord,
};
use crate::db::DbPool;
use crate::domain::privacy::{require_private_access, require_unlocked_connection};
use crate::security::vault::VaultState;
use crate::services::episode_thumbnails;
use crate::services::playback_engine::MpvFunctions;
use crate::services::private_video_scanner::{self, PrivateScanSummary};
use crate::services::private_video_scanner::ScanProgressEmitter;
use tauri::{AppHandle, Emitter};
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;

/// Seuil au-delà duquel un visionnage est considéré terminé — identique à
/// celui du catalogue public (`domain::playback::COMPLETED_THRESHOLD`,
/// non réutilisé directement pour ne pas coupler les deux modules pour une
/// simple constante).
const COMPLETED_THRESHOLD: f64 = 0.95;

#[derive(Debug, Clone, Serialize)]
pub struct PrivateVideoFolderSummary {
    pub id: i64,
    pub private_library_id: i64,
    pub path: String,
    pub is_available: bool,
    pub added_at: String,
}

fn require_video_library(conn: &rusqlite::Connection, private_library_id: i64) -> Result<(), String> {
    let library = private_repository::get_by_id(conn, private_library_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Bibliothèque privée introuvable.".to_string())?;
    if library.kind != "videos" {
        return Err("Cette bibliothèque privée n'est pas de type Vidéos.".to_string());
    }
    Ok(())
}

pub fn list_folders(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    private_library_id: i64,
) -> Result<Vec<PrivateVideoFolderSummary>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    let folders = private_video_repository::list_folders_by_library(conn, private_library_id)
        .map_err(|e| e.to_string())?;
    Ok(folders
        .into_iter()
        .map(|folder| PrivateVideoFolderSummary {
            is_available: Path::new(&folder.path).exists(),
            id: folder.id,
            private_library_id: folder.private_library_id,
            path: folder.path,
            added_at: folder.added_at,
        })
        .collect())
}

pub fn list_files(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    private_library_id: i64,
) -> Result<Vec<PrivateVideoFileRecord>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_video_repository::list_files_by_library(conn, private_library_id).map_err(|e| e.to_string())
}

/// Ajoute un dossier puis lance immédiatement un scan de la bibliothèque
/// entière — même confort que l'ajout d'un dossier à une bibliothèque
/// publique (`commands::library::add_library_folder`), sans pour autant
/// activer de surveillance continue (scan manuel uniquement, doc §6.4
/// ter : ce n'est qu'une commodité au moment de l'ajout, pas un watcher).
pub fn add_folder(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    private_library_id: i64,
        mpv_functions: Option<Arc<MpvFunctions>>,
    path: &str,
    app: &AppHandle,
) -> Result<PrivateScanSummary, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    require_video_library(conn, private_library_id)?;
    if !Path::new(path).is_dir() {
        return Err("Le chemin choisi n'est pas un dossier accessible.".to_string());
    }
    private_video_repository::create_folder(conn, private_library_id, path).map_err(|e| e.to_string())?;
        let summary = private_video_scanner::scan_library(conn, private_library_id, app)?;
    // Étape 6d-privé : vignettes chiffrées, best-effort, avant la
    // persistance unique de fin de scan.
    let _ = generate_thumbnails_after_scan(conn, mpv_functions.as_ref(), private_library_id, app);
    vault_state.persist_if_unlocked()?;
    emit_private_done(app, private_library_id);
    Ok(summary)
}

pub fn remove_folder(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    folder_id: i64,
) -> Result<(), String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_video_repository::delete_folder(conn, folder_id).map_err(|e| e.to_string())?;
    vault_state.persist_if_unlocked()
}

/// Scan manuel déclenché explicitement (bouton dédié) — voir la note de
/// tête de ce module sur l'absence volontaire de surveillance continue.
pub fn trigger_scan(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    private_library_id: i64,
    mpv_functions: Option<Arc<MpvFunctions>>,
    app: &AppHandle,
) -> Result<PrivateScanSummary, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    require_video_library(conn, private_library_id)?;
    let summary = private_video_scanner::scan_library(conn, private_library_id, app)?;
    // Étape 6d-privé : vignettes chiffrées des fichiers sans aperçu.
    let _ = generate_thumbnails_after_scan(conn, mpv_functions.as_ref(), private_library_id, app);
    vault_state.persist_if_unlocked()?;
    emit_private_done(app, private_library_id);
    Ok(summary)
}

/// Signal de fin de toute la chaîne scan → vignettes : la barre de
/// progression privée se masque ~1 s après (composant frontend).
fn emit_private_done(app: &AppHandle, private_library_id: i64) {
    let _ = app.emit(
        "private:scan-progress",
        serde_json::json!({
            "private_library_id": private_library_id,
            "phase": "done",
            "processed": 0,
            "total": 0,
            "current": "",
        }),
    );
}

/// Étape 6d-privé : génère les vignettes manquantes d'une bibliothèque
/// vidéo privée (JPEG ~480 px encodé EN MÉMOIRE par
/// `episode_thumbnails::extract_jpeg_bytes`, stocké chiffré dans
/// `vault.db`). Best-effort : libmpv absente → sauté ; fichier
/// pathologique → compté en échec, les autres continuent. Le mutex du
/// coffre reste retenu pour la durée de la génération — même compromis
/// assumé que le scan d'images privées (doc §6.4 quater).
fn generate_thumbnails_after_scan(
    conn: &rusqlite::Connection,
    mpv_functions: Option<&Arc<MpvFunctions>>,
    private_library_id: i64,
    app: &AppHandle,
) -> Result<(u32, u32), String> {
    let Some(functions) = mpv_functions else {
        log::info!("[vignettes-privé] libmpv indisponible — génération sautée.");
        return Ok((0, 0));
    };
    let targets = private_video_repository::missing_thumbnails(conn, private_library_id)
        .map_err(|e| e.to_string())?;
    if targets.is_empty() {
        return Ok((0, 0));
    }
        log::info!(
        "[vignettes-privé] bibliothèque {private_library_id} : {} fichier(s) à traiter.",
        targets.len()
    );
    let total = targets.len() as u64;
    let mut progress = ScanProgressEmitter::new(app, private_library_id, total);
    progress.tick("thumbnails", 0, "", true);
    let mut generated = 0u32;
    let mut failed = 0u32;
    let mut processed: u64 = 0;
    for (file_id, path) in targets {
        if !Path::new(&path).exists() {
            failed += 1;
            continue;
        }
        match episode_thumbnails::extract_jpeg_bytes(functions.clone(), path.clone()) {
            Ok(bytes) => match private_video_repository::update_thumbnail(conn, file_id, &bytes) {
                Ok(()) => generated += 1,
                Err(e) => {
                    log::warn!(
                        "[vignettes-privé] fichier {file_id} : vignette créée mais base non mise à jour : {e}"
                    );
                    failed += 1;
                }
            },
                        Err(e) => {
                log::warn!("[vignettes-privé] fichier {file_id} : {e}");
                failed += 1;
            }
        }
        processed += 1;
        let current = Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        progress.tick("thumbnails", processed, &current, false);
    }
    progress.tick("thumbnails", processed, "", true);
    log::info!(
        "[vignettes-privé] bibliothèque {private_library_id} : {generated} vignette(s), {failed} échec(s)."
    );
    Ok((generated, failed))
}

/// Étape 6d-privé : lit la vignette chiffrée d'un fichier privé (octets
/// JPEG bruts) — la commande Tauri correspondante l'encode en base64 pour
/// le frontend, même pattern que la galerie d'images (§6.4 quater).
pub fn get_thumbnail(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    file_id: i64,
) -> Result<Vec<u8>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_video_repository::get_thumbnail(conn, file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Aucune vignette pour ce fichier.".to_string())
}

pub fn get_playback_progress(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    media_file_id: i64,
) -> Result<Option<PrivatePlaybackProgressRecord>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_video_repository::get_progress(conn, active_profile_id, media_file_id).map_err(|e| e.to_string())
}

/// Volontairement asymétrique en termes de persistance (voir la note de
/// tête du module) : seule la branche "visionnage terminé" appelle
/// `persist_if_unlocked()` — les mises à jour de position ordinaires
/// restent en mémoire jusqu'au prochain point de contrôle (fin de
/// visionnage suivante, ou verrouillage du coffre).
pub fn save_playback_progress(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    let is_completed =
        duration_seconds > 0.0 && position_seconds / duration_seconds >= COMPLETED_THRESHOLD;
    if is_completed {
        private_video_repository::clear_progress(conn, active_profile_id, media_file_id)
            .map_err(|e| e.to_string())?;
        vault_state.persist_if_unlocked()
    } else {
        private_video_repository::upsert_progress(
            conn,
            active_profile_id,
            media_file_id,
            position_seconds,
            duration_seconds,
        )
        .map_err(|e| e.to_string())
    }
}