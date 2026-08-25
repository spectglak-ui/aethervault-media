//! Accès SQL aux tables `private_image_folders`/`private_image_files` —
//! toutes à l'intérieur de `vault.db` (doc §6.4 quater). Même principe que
//! `private_video_repository` (Étape 6b-i), avec en plus la gestion de la
//! couverture d'album et des vignettes chiffrées.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
pub struct PrivateImageFolderRecord {
    pub id: i64,
    pub private_library_id: i64,
    pub path: String,
    pub cover_file_id: Option<i64>,
    pub added_at: String,
}

/// Sans `thumbnail_blob` volontairement : la vignette elle-même se
/// récupère via une commande dédiée (`get_thumbnail`), jamais incluse dans
/// un listing — envoyer des dizaines de vignettes dans une seule réponse
/// JSON serait inutilement coûteux (doc §6.4 quater).
#[derive(Debug, Clone, Serialize)]
pub struct PrivateImageFileRecord {
    pub id: i64,
    pub private_library_id: i64,
    pub folder_id: i64,
    pub path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub modified_at: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub taken_at: Option<String>,
    pub camera_model: Option<String>,
    pub has_thumbnail: bool,
    pub is_available: bool,
    pub discovered_at: String,
}

/// Données extraites par `services::private_image_scanner` pour un
/// fichier — ce module ne connaît que le schéma SQL, jamais le décodage
/// d'image ni l'EXIF.
pub struct NewImageFileData<'a> {
    pub path: &'a str,
    pub file_name: &'a str,
    pub size_bytes: i64,
    pub modified_at: &'a str,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub taken_at: Option<&'a str>,
    pub camera_model: Option<&'a str>,
    pub thumbnail: Option<&'a [u8]>,
}

const FILE_COLUMNS: &str = "id, private_library_id, folder_id, path, file_name, size_bytes, \
    modified_at, width, height, taken_at, camera_model, thumbnail_blob IS NOT NULL, is_available, discovered_at";

fn map_file_row(row: &rusqlite::Row) -> rusqlite::Result<PrivateImageFileRecord> {
    Ok(PrivateImageFileRecord {
        id: row.get(0)?,
        private_library_id: row.get(1)?,
        folder_id: row.get(2)?,
        path: row.get(3)?,
        file_name: row.get(4)?,
        size_bytes: row.get(5)?,
        modified_at: row.get(6)?,
        width: row.get(7)?,
        height: row.get(8)?,
        taken_at: row.get(9)?,
        camera_model: row.get(10)?,
        has_thumbnail: row.get(11)?,
        is_available: row.get(12)?,
        discovered_at: row.get(13)?,
    })
}

// --- Dossiers (albums) -------------------------------------------------------

pub fn create_folder(conn: &Connection, private_library_id: i64, path: &str) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO private_image_folders (private_library_id, path, added_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![private_library_id, path, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_folder(conn: &Connection, folder_id: i64) -> rusqlite::Result<Option<PrivateImageFolderRecord>> {
    conn.query_row(
        "SELECT id, private_library_id, path, cover_file_id, added_at
         FROM private_image_folders WHERE id = ?1",
        rusqlite::params![folder_id],
        |row| {
            Ok(PrivateImageFolderRecord {
                id: row.get(0)?,
                private_library_id: row.get(1)?,
                path: row.get(2)?,
                cover_file_id: row.get(3)?,
                added_at: row.get(4)?,
            })
        },
    )
    .optional()
}

pub fn list_folders_by_library(
    conn: &Connection,
    private_library_id: i64,
) -> rusqlite::Result<Vec<PrivateImageFolderRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, private_library_id, path, cover_file_id, added_at
         FROM private_image_folders WHERE private_library_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(rusqlite::params![private_library_id], |row| {
        Ok(PrivateImageFolderRecord {
            id: row.get(0)?,
            private_library_id: row.get(1)?,
            path: row.get(2)?,
            cover_file_id: row.get(3)?,
            added_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn delete_folder(conn: &Connection, folder_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM private_image_folders WHERE id = ?1", rusqlite::params![folder_id])?;
    Ok(())
}

/// `None` réinitialise à la couverture par défaut (première photo). Ne
/// vérifie pas ici que `file_id` appartient bien à `folder_id` — c'est la
/// responsabilité de l'appelant (`domain::private_image::set_album_cover`),
/// cette fonction reste un pur accès SQL.
pub fn set_cover(conn: &Connection, folder_id: i64, file_id: Option<i64>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE private_image_folders SET cover_file_id = ?1 WHERE id = ?2",
        rusqlite::params![file_id, folder_id],
    )?;
    Ok(())
}

/// Vignette de couverture d'un album : celle choisie explicitement
/// (`cover_file_id`) si elle existe, sinon celle de la première photo par
/// nom de fichier (doc §6.4 quater, "par défaut : première image").
pub fn get_cover_thumbnail(conn: &Connection, folder_id: i64) -> rusqlite::Result<Option<Vec<u8>>> {
    let result: Option<Option<Vec<u8>>> = conn
        .query_row(
            "SELECT f.thumbnail_blob
             FROM private_image_folders AS d
             LEFT JOIN private_image_files AS f
                 ON f.id = COALESCE(
                     d.cover_file_id,
                     (SELECT id FROM private_image_files
                      WHERE folder_id = d.id
                      ORDER BY file_name COLLATE NOCASE ASC LIMIT 1)
                 )
             WHERE d.id = ?1",
            rusqlite::params![folder_id],
            |row| row.get::<_, Option<Vec<u8>>>(0),
        )
        .optional()?;

    Ok(result.flatten())
}

// --- Fichiers ------------------------------------------------------------------

pub fn list_files_by_folder(
    conn: &Connection,
    folder_id: i64,
) -> rusqlite::Result<Vec<PrivateImageFileRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {FILE_COLUMNS} FROM private_image_files WHERE folder_id = ?1 ORDER BY file_name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(rusqlite::params![folder_id], map_file_row)?;
    rows.collect()
}

pub fn get_file(conn: &Connection, file_id: i64) -> rusqlite::Result<Option<PrivateImageFileRecord>> {
    conn.query_row(
        &format!("SELECT {FILE_COLUMNS} FROM private_image_files WHERE id = ?1"),
        rusqlite::params![file_id],
        map_file_row,
    )
    .optional()
}

pub fn get_thumbnail(conn: &Connection, file_id: i64) -> rusqlite::Result<Option<Vec<u8>>> {
    let result: Option<Option<Vec<u8>>> = conn
        .query_row(
            "SELECT thumbnail_blob FROM private_image_files WHERE id = ?1",
            rusqlite::params![file_id],
            |row| row.get::<_, Option<Vec<u8>>>(0),
        )
        .optional()?;

    Ok(result.flatten())
}

/// Insère un fichier nouvellement découvert, ou met à jour ses métadonnées
/// et sa vignette s'il existait déjà. Renvoie `true` si le fichier était
/// nouveau — même contrat que `private_video_repository::upsert_file`.
pub fn upsert_file(
    conn: &Connection,
    private_library_id: i64,
    folder_id: i64,
    data: &NewImageFileData,
) -> rusqlite::Result<bool> {
    let now = chrono::Utc::now().to_rfc3339();

    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM private_image_files WHERE path = ?1",
            rusqlite::params![data.path],
            |row| row.get(0),
        )
        .optional()?;

    match existing_id {
        Some(id) => {
            conn.execute(
                "UPDATE private_image_files
                 SET size_bytes = ?1, modified_at = ?2, width = ?3, height = ?4,
                     taken_at = ?5, camera_model = ?6, thumbnail_blob = ?7,
                     is_available = 1, updated_at = ?8
                 WHERE id = ?9",
                rusqlite::params![
                    data.size_bytes,
                    data.modified_at,
                    data.width,
                    data.height,
                    data.taken_at,
                    data.camera_model,
                    data.thumbnail,
                    now,
                    id
                ],
            )?;
            Ok(false)
        }
        None => {
            conn.execute(
                "INSERT INTO private_image_files
                    (private_library_id, folder_id, path, file_name, size_bytes, modified_at,
                     width, height, taken_at, camera_model, thumbnail_blob, is_available,
                     discovered_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12)",
                rusqlite::params![
                    private_library_id,
                    folder_id,
                    data.path,
                    data.file_name,
                    data.size_bytes,
                    data.modified_at,
                    data.width,
                    data.height,
                    data.taken_at,
                    data.camera_model,
                    data.thumbnail,
                    now
                ],
            )?;
            Ok(true)
        }
    }
}

/// Supprime les fichiers auparavant connus dans ce dossier mais absents du
/// dernier parcours. Renvoie le nombre de fichiers supprimés.
pub fn remove_missing(
    conn: &Connection,
    folder_id: i64,
    seen_paths: &HashSet<String>,
) -> rusqlite::Result<u64> {
    let mut stmt = conn.prepare("SELECT id, path FROM private_image_files WHERE folder_id = ?1")?;
    let known: Vec<(i64, String)> = stmt
        .query_map(rusqlite::params![folder_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut removed = 0u64;
    for (id, path) in known {
        if !seen_paths.contains(&path) {
            conn.execute("DELETE FROM private_image_files WHERE id = ?1", rusqlite::params![id])?;
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn mark_folder_unavailable(conn: &Connection, folder_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE private_image_files SET is_available = 0 WHERE folder_id = ?1",
        rusqlite::params![folder_id],
    )?;
    Ok(())
}
