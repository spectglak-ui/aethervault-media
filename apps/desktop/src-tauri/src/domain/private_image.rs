//! Images privées (Étape 6b-ii, doc §6.4 quater).
//!
//! Même double vérification que le reste du Privacy/Security Manager
//! (`domain::privacy`) à chaque fonction : coffre déverrouillé **et**
//! profil actif autorisé (`can_access_private`) — réutilise directement
//! `domain::privacy::require_private_access`/`require_unlocked_connection`,
//! même principe que `domain::private_video` (Étape 6b-i).
//!
//! Persistance : dossiers/scan persistés une fois à la fin (même stratégie
//! que les vidéos, doc §6.4 bis/ter) — pas de cas "progression de lecture"
//! ici, rien à traiter différemment sur ce point pour les images.

use crate::db::repositories::private_image_repository::{
    self, PrivateImageFileRecord, PrivateImageFolderRecord,
};
use crate::db::repositories::private_repository;
use crate::db::DbPool;
use crate::domain::privacy::{require_private_access, require_unlocked_connection};
use crate::security::vault::VaultState;
use crate::services::private_image_scanner::{self, PrivateImageScanSummary};
use std::path::Path;

fn require_image_library(conn: &rusqlite::Connection, private_library_id: i64) -> Result<(), String> {
    let library = private_repository::get_by_id(conn, private_library_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Bibliothèque privée introuvable.".to_string())?;
    if library.kind != "images" {
        return Err("Cette bibliothèque privée n'est pas de type Images.".to_string());
    }
    Ok(())
}

pub fn list_folders(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    private_library_id: i64,
) -> Result<Vec<PrivateImageFolderRecord>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_image_repository::list_folders_by_library(conn, private_library_id).map_err(|e| e.to_string())
}

/// Ajoute un dossier puis lance immédiatement un scan de la bibliothèque
/// entière — même confort qu'à l'Étape 6b-i, toujours sans surveillance
/// continue (scan manuel uniquement, doc §6.4 ter/quater).
pub fn add_folder(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    private_library_id: i64,
    path: &str,
) -> Result<PrivateImageScanSummary, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    require_image_library(conn, private_library_id)?;

    if !Path::new(path).is_dir() {
        return Err("Le chemin choisi n'est pas un dossier accessible.".to_string());
    }

    private_image_repository::create_folder(conn, private_library_id, path).map_err(|e| e.to_string())?;
    let summary = private_image_scanner::scan_library(conn, private_library_id)?;

    vault_state.persist_if_unlocked()?;

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

    private_image_repository::delete_folder(conn, folder_id).map_err(|e| e.to_string())?;
    vault_state.persist_if_unlocked()
}

pub fn trigger_scan(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    private_library_id: i64,
) -> Result<PrivateImageScanSummary, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    require_image_library(conn, private_library_id)?;

    let summary = private_image_scanner::scan_library(conn, private_library_id)?;
    vault_state.persist_if_unlocked()?;

    Ok(summary)
}

pub fn list_files(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    folder_id: i64,
) -> Result<Vec<PrivateImageFileRecord>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_image_repository::list_files_by_folder(conn, folder_id).map_err(|e| e.to_string())
}

pub fn get_thumbnail(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    file_id: i64,
) -> Result<Option<Vec<u8>>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_image_repository::get_thumbnail(conn, file_id).map_err(|e| e.to_string())
}

/// Vignette de couverture d'un album — celle choisie explicitement, sinon
/// celle de la première photo (doc §6.4 quater).
pub fn get_album_cover(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    folder_id: i64,
) -> Result<Option<Vec<u8>>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_image_repository::get_cover_thumbnail(conn, folder_id).map_err(|e| e.to_string())
}

/// `file_id = None` réinitialise à la couverture par défaut (première
/// photo). `Some(file_id)` doit obligatoirement référencer un fichier du
/// **même dossier** — jamais un fichier externe arbitraire, contrairement
/// aux bannières de catégories/Titres (`custom_images`) — voir doc §6.4
/// quater pour la justification complète de cet écart assumé.
pub fn set_album_cover(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    folder_id: i64,
    file_id: Option<i64>,
) -> Result<(), String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;

    if let Some(file_id) = file_id {
        let file = private_image_repository::get_file(conn, file_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Photo introuvable.".to_string())?;
        if file.folder_id != folder_id {
            return Err("Cette photo n'appartient pas à cet album.".to_string());
        }
    }

    private_image_repository::set_cover(conn, folder_id, file_id).map_err(|e| e.to_string())?;
    vault_state.persist_if_unlocked()
}
