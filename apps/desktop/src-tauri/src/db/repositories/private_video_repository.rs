//! Accès SQL aux tables `private_video_folders`, `private_video_files` et
//! `private_playback_progress` — toutes à l'intérieur de `vault.db` (doc
//! §6.4 ter). Même principe que `folder_repository`/`media_repository`
//! (bibliothèques publiques), mais un module séparé : deux bases de
//! données différentes, jamais la même connexion.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
pub struct PrivateVideoFolderRecord {
    pub id: i64,
    pub private_library_id: i64,
    pub path: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrivateVideoFileRecord {
    pub id: i64,
    pub private_library_id: i64,
    pub folder_id: i64,
    pub path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub modified_at: String,
    pub is_available: bool,
    pub discovered_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrivatePlaybackProgressRecord {
    pub media_file_id: i64,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub updated_at: String,
}

// --- Dossiers --------------------------------------------------------------

pub fn create_folder(conn: &Connection, private_library_id: i64, path: &str) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO private_video_folders (private_library_id, path, added_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![private_library_id, path, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_folders_by_library(
    conn: &Connection,
    private_library_id: i64,
) -> rusqlite::Result<Vec<PrivateVideoFolderRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, private_library_id, path, added_at
         FROM private_video_folders WHERE private_library_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(rusqlite::params![private_library_id], |row| {
        Ok(PrivateVideoFolderRecord {
            id: row.get(0)?,
            private_library_id: row.get(1)?,
            path: row.get(2)?,
            added_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// Supprime le dossier et renvoie son chemin s'il existait — même
/// principe que `folder_repository::delete`, même si l'Étape 6b-i ne s'en
/// sert pas encore pour arrêter une surveillance (pas de watcher privé
/// pour l'instant, doc §6.4 ter).
pub fn delete_folder(conn: &Connection, folder_id: i64) -> rusqlite::Result<Option<String>> {
    let path: Option<String> = conn
        .query_row(
            "SELECT path FROM private_video_folders WHERE id = ?1",
            rusqlite::params![folder_id],
            |row| row.get(0),
        )
        .optional()?;

    conn.execute(
        "DELETE FROM private_video_folders WHERE id = ?1",
        rusqlite::params![folder_id],
    )?;

    Ok(path)
}

// --- Fichiers ----------------------------------------------------------------

pub fn list_files_by_library(
    conn: &Connection,
    private_library_id: i64,
) -> rusqlite::Result<Vec<PrivateVideoFileRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, private_library_id, folder_id, path, file_name, size_bytes, modified_at, is_available, discovered_at
         FROM private_video_files WHERE private_library_id = ?1 ORDER BY file_name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(rusqlite::params![private_library_id], |row| {
        Ok(PrivateVideoFileRecord {
            id: row.get(0)?,
            private_library_id: row.get(1)?,
            folder_id: row.get(2)?,
            path: row.get(3)?,
            file_name: row.get(4)?,
            size_bytes: row.get(5)?,
            modified_at: row.get(6)?,
            is_available: row.get(7)?,
            discovered_at: row.get(8)?,
        })
    })?;
    rows.collect()
}

/// Insère un fichier nouvellement découvert, ou met à jour ses métadonnées
/// s'il existait déjà. Renvoie `true` si le fichier était nouveau — même
/// contrat que `media_repository::upsert`.
#[allow(clippy::too_many_arguments)]
pub fn upsert_file(
    conn: &Connection,
    private_library_id: i64,
    folder_id: i64,
    path: &str,
    file_name: &str,
    size_bytes: i64,
    modified_at: &str,
) -> rusqlite::Result<bool> {
    let now = chrono::Utc::now().to_rfc3339();

    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM private_video_files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get(0),
        )
        .optional()?;

    match existing_id {
        Some(id) => {
            conn.execute(
                "UPDATE private_video_files
                 SET size_bytes = ?1, modified_at = ?2, is_available = 1, updated_at = ?3
                 WHERE id = ?4",
                rusqlite::params![size_bytes, modified_at, now, id],
            )?;
            Ok(false)
        }
        None => {
            conn.execute(
                "INSERT INTO private_video_files
                    (private_library_id, folder_id, path, file_name, size_bytes, modified_at, is_available, discovered_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
                rusqlite::params![private_library_id, folder_id, path, file_name, size_bytes, modified_at, now],
            )?;
            Ok(true)
        }
    }
}

/// Supprime les fichiers auparavant connus dans ce dossier mais absents du
/// dernier parcours. Renvoie le nombre de fichiers supprimés — même
/// principe que `media_repository::remove_missing`.
pub fn remove_missing(
    conn: &Connection,
    folder_id: i64,
    seen_paths: &HashSet<String>,
) -> rusqlite::Result<u64> {
    let mut stmt = conn.prepare("SELECT id, path FROM private_video_files WHERE folder_id = ?1")?;
    let known: Vec<(i64, String)> = stmt
        .query_map(rusqlite::params![folder_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut removed = 0u64;
    for (id, path) in known {
        if !seen_paths.contains(&path) {
            conn.execute("DELETE FROM private_video_files WHERE id = ?1", rusqlite::params![id])?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Marque tous les fichiers d'un dossier comme indisponibles sans les
/// supprimer (dossier temporairement inaccessible) — même principe que
/// `media_repository::mark_folder_unavailable`.
pub fn mark_folder_unavailable(conn: &Connection, folder_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE private_video_files SET is_available = 0 WHERE folder_id = ?1",
        rusqlite::params![folder_id],
    )?;
    Ok(())
}

// --- Progression de lecture --------------------------------------------------

pub fn get_progress(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
) -> rusqlite::Result<Option<PrivatePlaybackProgressRecord>> {
    conn.query_row(
        "SELECT media_file_id, position_seconds, duration_seconds, updated_at
         FROM private_playback_progress WHERE profile_id = ?1 AND media_file_id = ?2",
        rusqlite::params![profile_id, media_file_id],
        |row| {
            Ok(PrivatePlaybackProgressRecord {
                media_file_id: row.get(0)?,
                position_seconds: row.get(1)?,
                duration_seconds: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
    .optional()
}

pub fn upsert_progress(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO private_playback_progress (profile_id, media_file_id, position_seconds, duration_seconds, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(profile_id, media_file_id) DO UPDATE SET
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            updated_at = excluded.updated_at",
        rusqlite::params![profile_id, media_file_id, position_seconds, duration_seconds, now],
    )?;
    Ok(())
}

pub fn clear_progress(conn: &Connection, profile_id: i64, media_file_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM private_playback_progress WHERE profile_id = ?1 AND media_file_id = ?2",
        rusqlite::params![profile_id, media_file_id],
    )?;
    Ok(())
}

/// Étape 6d-privé : fichiers d'une bibliothèque privée n'ayant pas encore
/// de vignette — cibles de la génération automatique au scan.
// --- Vignettes (Étape 6d-privé) -----------------------------------------

/// Fichiers d'une bibliothèque privée n'ayant pas encore de vignette —
/// cibles de la génération automatique au scan.
pub fn missing_thumbnails(
    conn: &Connection,
    private_library_id: i64,
) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, path FROM private_video_files
         WHERE private_library_id = ?1 AND thumbnail_blob IS NULL
         ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![private_library_id], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?;
    rows.collect()
}

/// Enregistre la vignette (JPEG en octets) d'un fichier privé — le BLOB
/// vivra chiffré dans vault.db après `persist_if_unlocked`.
pub fn update_thumbnail(conn: &Connection, file_id: i64, blob: &[u8]) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE private_video_files SET thumbnail_blob = ?1 WHERE id = ?2",
        rusqlite::params![blob, file_id],
    )?;
    Ok(())
}

/// Lit la vignette d'un fichier privé (None si pas encore générée).
pub fn get_thumbnail(conn: &Connection, file_id: i64) -> rusqlite::Result<Option<Vec<u8>>> {
    conn.query_row(
        "SELECT thumbnail_blob FROM private_video_files WHERE id = ?1",
        rusqlite::params![file_id],
        |row| row.get(0),
    )
}