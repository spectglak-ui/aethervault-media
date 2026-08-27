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
//!
//! Barre de progression (Étape 6d) : un premier parcours léger compte les
//! fichiers candidats, puis le parcours de traitement émet
//! `library:scan-progress` (phase "scan", traités/total + fichier courant)
//! au plus toutes les ~150 ms — le frontend (`LibraryDetailPage`) affiche
//! une barre déterminée. Les phases suivantes ("metadata", "thumbnails")
//! sont émises par `commands::library` et `services::episode_thumbnails`,
//! et un événement final `phase: "done"` (émis par `commands::library`)
//! signale la fin de TOUTE la chaîne scan → appariement → vignettes.
use crate::db::repositories::{folder_repository, media_repository};
use crate::db::DbPool;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "flv", "mpg", "mpeg", "ts",
];

/// Intervalle minimal entre deux émissions de progression — évite
/// d'inonder l'IPC sur les bibliothèques de plusieurs milliers de fichiers
/// (une barre de progression n'a de toute façon pas besoin de plus pour
/// être fluide).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

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

/// Émet `library:scan-progress` en respectant `PROGRESS_INTERVAL`
/// (`force` passe outre, pour les ticks de fin/transition).
struct ProgressEmitter<'a> {
    app_handle: &'a AppHandle,
    library_id: i64,
    total: u64,
    last: Option<Instant>,
}

impl<'a> ProgressEmitter<'a> {
    fn new(app_handle: &'a AppHandle, library_id: i64, total: u64) -> Self {
        Self {
            app_handle,
            library_id,
            total,
            last: None,
        }
    }

    fn tick(&mut self, phase: &str, processed: u64, current: &str, force: bool) {
        let now = Instant::now();
        if !force
            && self
                .last
                .map(|previous| now.duration_since(previous) < PROGRESS_INTERVAL)
                .unwrap_or(false)
        {
            return;
        }
        self.last = Some(now);
        let _ = self.app_handle.emit(
            "library:scan-progress",
            serde_json::json!({
                "library_id": self.library_id,
                "phase": phase,
                "processed": processed,
                "total": self.total,
                "current": current,
            }),
        );
    }
}

/// Scanne l'ensemble des dossiers d'une bibliothèque et émet des
/// événements de progression (`library:scan-progress`, phase "scan") pour
/// que l'interface affiche une barre d'avancement déterminée — le scan
/// lui-même tourne dans un thread dédié (voir
/// `commands::library::trigger_scan`).
pub fn scan_library(
    pool: &DbPool,
    library_id: i64,
    app_handle: &AppHandle,
) -> Result<ScanSummary, Box<dyn std::error::Error>> {
    let conn = pool.get()?;
    let folders = folder_repository::list_by_library(&conn, library_id)?;

    // Premier parcours léger : compte les fichiers candidats pour une
    // barre déterminée (traités / total). Ce parcours ne fait que lire les
    // entrées de dossier (pas de `metadata()` par fichier) : son coût est
    // négligeable devant le parcours de traitement qui suit.
    let mut total_files: u64 = 0;
    for folder in &folders {
        let root = Path::new(&folder.path);
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() && is_video_file(entry.path()) {
                total_files += 1;
            }
        }
    }
    let mut progress = ProgressEmitter::new(app_handle, library_id, total_files);

    let mut added = 0u64;
    let mut updated = 0u64;
    let mut removed = 0u64;
    let mut unavailable_folders = 0u64;
    let mut processed: u64 = 0;

    for folder in folders {
        let root = Path::new(&folder.path);
        if !root.exists() {
            unavailable_folders += 1;
            media_repository::mark_folder_unavailable(&conn, folder.id)?;
            progress.tick("scan", processed, &folder.path, true);
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
            processed += 1;
            progress.tick("scan", processed, &file_name, false);
        }
        removed += media_repository::remove_missing(&conn, folder.id, &seen_paths)?;
    }
    progress.tick("scan", processed, "", true);

    Ok(ScanSummary {
        library_id,
        added,
        updated,
        removed,
        unavailable_folders,
    })
}