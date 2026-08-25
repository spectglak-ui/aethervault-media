//! File Scanner : parcourt les dossiers d'une bibliothèque à la recherche
//! de fichiers vidéo, et met à jour la base en conséquence.
//!
//! Logique de disponibilité (Étape 2a, sans Filesystem Watcher ni
//! identification de volume par numéro de série — voir Étape 2b) :
//! - dossier introuvable (`chemin.exists()` faux) → tous ses fichiers
//!   connus sont marqués indisponibles, jamais supprimés ;
//! - dossier accessible → chaque fichier vidéo trouvé est ajouté/mis à
//!   jour ; tout fichier connu mais absent du nouveau parcours est
//!   considéré réellement supprimé (le dossier étant, lui, accessible).

use crate::db::repositories::{folder_repository, media_repository};
use crate::db::DbPool;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "flv", "mpg", "mpeg", "ts",
];

#[derive(Debug, Clone, Serialize)]
pub struct ScanSummary {
    pub library_id: i64,
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub unavailable_folders: u64,
}

fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Scanne l'ensemble des dossiers d'une bibliothèque et émet un événement
/// de progression par dossier traité (`library:scan-progress`), pour que
/// l'interface puisse afficher un état d'avancement sans bloquer — le scan
/// lui-même tourne dans un thread dédié (voir `commands::library::trigger_scan`).
pub fn scan_library(
    pool: &DbPool,
    library_id: i64,
    app_handle: &AppHandle,
) -> Result<ScanSummary, Box<dyn std::error::Error>> {
    let conn = pool.get()?;
    let folders = folder_repository::list_by_library(&conn, library_id)?;

    let mut added = 0u64;
    let mut updated = 0u64;
    let mut removed = 0u64;
    let mut unavailable_folders = 0u64;

    for folder in folders {
        let root = Path::new(&folder.path);

        if !root.exists() {
            unavailable_folders += 1;
            media_repository::mark_folder_unavailable(&conn, folder.id)?;
            let _ = app_handle.emit(
                "library:scan-progress",
                serde_json::json!({
                    "library_id": library_id,
                    "folder_path": folder.path,
                    "status": "unavailable",
                }),
            );
            continue;
        }

        let mut seen_paths: HashSet<String> = HashSet::new();

        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if !is_video_file(path) {
                continue;
            }

            let path_string = path.to_string_lossy().to_string();
            seen_paths.insert(path_string.clone());

            let metadata = entry.metadata()?;
            let size_bytes = metadata.len() as i64;
            let modified_at = metadata
                .modified()
                .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339())
                .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339());
            let file_name = entry.file_name().to_string_lossy().to_string();

            let was_inserted = media_repository::upsert(
                &conn,
                library_id,
                folder.id,
                &path_string,
                &file_name,
                size_bytes,
                &modified_at,
            )?;

            if was_inserted {
                added += 1;
            } else {
                updated += 1;
            }
        }

        removed += media_repository::remove_missing(&conn, folder.id, &seen_paths)?;

        let _ = app_handle.emit(
            "library:scan-progress",
            serde_json::json!({
                "library_id": library_id,
                "folder_path": folder.path,
                "status": "scanned",
            }),
        );
    }

    Ok(ScanSummary {
        library_id,
        added,
        updated,
        removed,
        unavailable_folders,
    })
}
