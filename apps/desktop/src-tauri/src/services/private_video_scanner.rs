//! Scanner de dossiers vidéo privés (Étape 6b-i, doc §6.4 ter).
//!
//! Implémentation séparée de `services::scanner` (bibliothèques publiques)
//! plutôt que réutilisée telle quelle : ce module opère sur la connexion
//! en mémoire du coffre (`security::vault::VaultHandle`), pas sur le pool
//! principal — deux bases de données différentes, deux repositories
//! différents. Mêmes extensions vidéo reconnues que `services::scanner`,
//! pour un comportement cohérent entre bibliothèques publiques et privées.
//!
//! Architecture pensée pour ne jamais avoir à être réécrite si un
//! Filesystem Watcher privé est ajouté plus tard (doc §6.4 ter, décision
//! validée : scan manuel uniquement pour cette première version) : la
//! détection de type de fichier (`is_video_file`) et le traitement d'un
//! **seul** fichier déjà localisé (`upsert_one_file`) sont isolés du
//! parcours complet d'un dossier (`scan_library`). Un futur watcher
//! n'appellerait que `upsert_one_file` (et un futur `remove_one_file`,
//! trivial à ajouter sur le même principe que
//! `private_video_repository::delete_folder`) pour le seul chemin concerné
//! par un événement filesystem — sans dupliquer la détection ni le
//! parcours. Ce module ne connaît volontairement ni `AppState` ni le mutex
//! du coffre : `domain::private_video` est seul responsable de vérifier
//! l'autorisation, de fournir la connexion déverrouillée, et de persister
//! le résultat une fois le parcours terminé.

use crate::db::repositories::private_video_repository;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "flv", "mpg", "mpeg", "ts",
];

pub fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertOutcome {
    Added,
    Updated,
}

/// Traite un seul fichier déjà confirmé comme existant et vidéo — unité
/// réutilisable telle quelle par un futur watcher (un événement = un
/// appel ici), sans jamais avoir à reparcourir tout un dossier.
pub fn upsert_one_file(
    conn: &Connection,
    private_library_id: i64,
    folder_id: i64,
    path: &Path,
) -> Result<UpsertOutcome, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size_bytes = metadata.len() as i64;
    let modified_at = metadata
        .modified()
        .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339())
        .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339());
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let path_string = path.to_string_lossy().to_string();

    let was_inserted = private_video_repository::upsert_file(
        conn,
        private_library_id,
        folder_id,
        &path_string,
        &file_name,
        size_bytes,
        &modified_at,
    )
    .map_err(|e| e.to_string())?;

    Ok(if was_inserted {
        UpsertOutcome::Added
    } else {
        UpsertOutcome::Updated
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct PrivateScanSummary {
    pub private_library_id: i64,
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub unavailable_folders: u64,
    /// Fichiers rencontrés mais dont le traitement a échoué (permissions,
    /// fichier supprimé entre le parcours et la lecture...) — n'interrompt
    /// plus le reste du scan depuis le correctif de robustesse ci-dessous
    /// (retour utilisateur après livraison).
    pub failed: u64,
}

/// Parcourt l'ensemble des dossiers d'une bibliothèque vidéo privée.
/// Contrairement à `services::scanner::scan_library` (bibliothèques
/// publiques, qui persiste au fil de l'eau sur `aethervault.db`, non
/// chiffrée), ne persiste jamais rien lui-même : le coffre (architecture
/// A2, doc §6.4 bis) n'est ré-écrit chiffré sur disque qu'une seule fois,
/// à la fin du scan complet, par l'appelant (`domain::private_video`) —
/// jamais fichier par fichier, ce qui ne tiendrait pas à l'échelle pour
/// des centaines de fichiers d'un coup.
pub fn scan_library(conn: &Connection, private_library_id: i64) -> Result<PrivateScanSummary, String> {
    let folders = private_video_repository::list_folders_by_library(conn, private_library_id)
        .map_err(|e| e.to_string())?;

    let mut added = 0u64;
    let mut updated = 0u64;
    let mut removed = 0u64;
    let mut unavailable_folders = 0u64;
    let mut failed = 0u64;

    for folder in folders {
        let root = Path::new(&folder.path);

        if !root.exists() {
            unavailable_folders += 1;
            private_video_repository::mark_folder_unavailable(conn, folder.id)
                .map_err(|e| e.to_string())?;
            continue;
        }

        let mut seen_paths: HashSet<String> = HashSet::new();

        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() || !is_video_file(entry.path()) {
                continue;
            }

            let path_string = entry.path().to_string_lossy().to_string();
            seen_paths.insert(path_string);

            // Correctif de robustesse (retour utilisateur après
            // livraison) : un fichier dont le traitement échoue (ex.
            // permissions, suppression entre le parcours et la lecture)
            // est désormais compté puis ignoré, plutôt que de faire
            // échouer immédiatement tout le scan via `?` — un seul fichier
            // problématique ne doit jamais faire perdre les autres.
            match upsert_one_file(conn, private_library_id, folder.id, entry.path()) {
                Ok(UpsertOutcome::Added) => added += 1,
                Ok(UpsertOutcome::Updated) => updated += 1,
                Err(_) => failed += 1,
            }
        }

        removed += private_video_repository::remove_missing(conn, folder.id, &seen_paths)
            .map_err(|e| e.to_string())?;
    }

    Ok(PrivateScanSummary {
        private_library_id,
        added,
        updated,
        removed,
        unavailable_folders,
        failed,
    })
}
