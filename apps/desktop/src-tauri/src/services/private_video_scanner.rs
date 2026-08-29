//! Scanner de dossiers vidéo privés (Étape 6b-i, doc §6.4 ter).
//!
//! Implémentation séparée de `services::scanner` (bibliothèques publiques)
//! plutôt que réutilisée telle quelle : ce module opère sur la connexion
//! en mémoire du coffre (`security::vault::VaultHandle`), pas sur le pool
//! principal — deux bases de données différentes, deux repositories
//! différents. Mêmes extensions vidéo reconnues que `services::scanner`,
//! pour un comportement cohérent entre bibliothèques publiques et privées.
//!
//! Étape 6d-privé : émission de `private:scan-progress` (phase "scan",
//! traités/total + dossier ou fichier courant) throttlée à ~150 ms, même
//! philosophie que le scanner public — l'interface affiche une barre
//! déterminée pendant le scan manuel.
use crate::db::repositories::private_video_repository;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "flv", "mpg", "mpeg", "ts",
];

/// Intervalle minimal entre deux émissions de progression — même
/// throttling que le scanner public (Étape 6d).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

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
    /// plus le reste du scan depuis le correctif de robustesse (retour
    /// utilisateur après livraison).
    pub failed: u64,
}

/// Émet `private:scan-progress` au plus toutes les ~150 ms (plus un envoi
/// forcé) — même philosophie que la barre du scanner public (Étape 6d).
/// Réutilisé par `domain::private_video` pour la phase "thumbnails".
pub struct ScanProgressEmitter<'a> {
    app_handle: &'a AppHandle,
    private_library_id: i64,
    total: u64,
    last: Option<Instant>,
}

impl<'a> ScanProgressEmitter<'a> {
    pub fn new(app_handle: &'a AppHandle, private_library_id: i64, total: u64) -> Self {
        Self {
            app_handle,
            private_library_id,
            total,
            last: None,
        }
    }

    pub fn tick(&mut self, phase: &str, processed: u64, current: &str, force: bool) {
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
            "private:scan-progress",
            serde_json::json!({
                "private_library_id": self.private_library_id,
                "phase": phase,
                "processed": processed,
                "total": self.total,
                "current": current,
            }),
        );
    }
}

/// Scan arborescent (Étape 8) : chaque répertoire contenant au moins une
/// vidéo reçoit son propre enregistrement de dossier (créé à la volée s'il
/// manque), et les fichiers sont rattachés à leur répertoire EXACT — la
/// page privée reconstruit l'arbre du disque à partir de ces chemins.
/// Les fichiers directement sous la racine restent rattachés à
/// l'enregistrement racine ; `remove_missing` nettoie les anciens
/// rattachements récursifs des bibliothèques scannées avant l'Étape 8.
pub fn scan_library(
    conn: &Connection,
    private_library_id: i64,
    app_handle: &AppHandle,
) -> Result<PrivateScanSummary, String> {
    let roots = private_video_repository::list_folders_by_library(conn, private_library_id)
        .map_err(|e| e.to_string())?;

    // Passe 1 : compte les fichiers candidats (barre déterminée) et
    // crée les enregistrements de sous-dossiers manquants.
    let mut total_files: u64 = 0;
    for root in &roots {
        let root_path = Path::new(&root.path);
        if !root_path.exists() {
            continue;
        }
        let mut dirs_with_videos: HashSet<std::path::PathBuf> = HashSet::new();
        for entry in WalkDir::new(root_path).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() && is_video_file(entry.path()) {
                total_files += 1;
                if let Some(parent) = entry.path().parent() {
                    dirs_with_videos.insert(parent.to_path_buf());
                }
            }
        }
        for dir in dirs_with_videos {
            let dir_string = dir.to_string_lossy().to_string();
            let exists =
                private_video_repository::folder_id_by_path(conn, private_library_id, &dir_string)
                    .map_err(|e| e.to_string())?;
            if exists.is_none() {
                private_video_repository::create_folder(conn, private_library_id, &dir_string)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    // Passe 2 : rattache les fichiers de chaque répertoire à son
    // enregistrement exact (parcours NON récursif).
    let folders = private_video_repository::list_folders_by_library(conn, private_library_id)
        .map_err(|e| e.to_string())?;
    let mut progress = ScanProgressEmitter::new(app_handle, private_library_id, total_files);
    let mut added = 0u64;
    let mut updated = 0u64;
    let mut removed = 0u64;
    let mut unavailable_folders = 0u64;
    let mut failed = 0u64;
    let mut processed: u64 = 0;
    for folder in folders {
        let dir = Path::new(&folder.path);
        if !dir.exists() {
            unavailable_folders += 1;
            private_video_repository::mark_folder_unavailable(conn, folder.id)
                .map_err(|e| e.to_string())?;
            progress.tick("scan", processed, &folder.path, true);
            continue;
        }
        progress.tick("scan", processed, &folder.path, true);
        let mut seen_paths: HashSet<String> = HashSet::new();
        let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() || !is_video_file(&path) {
                continue;
            }
            seen_paths.insert(path.to_string_lossy().to_string());
            match upsert_one_file(conn, private_library_id, folder.id, &path) {
                Ok(UpsertOutcome::Added) => added += 1,
                Ok(UpsertOutcome::Updated) => updated += 1,
                Err(_) => failed += 1,
            }
            processed += 1;
            progress.tick("scan", processed, &folder.path, false);
        }
        removed += private_video_repository::remove_missing(conn, folder.id, &seen_paths)
            .map_err(|e| e.to_string())?;
    }
    progress.tick("scan", processed, "", true);
    Ok(PrivateScanSummary {
        private_library_id,
        added,
        updated,
        removed,
        unavailable_folders,
        failed,
    })
}