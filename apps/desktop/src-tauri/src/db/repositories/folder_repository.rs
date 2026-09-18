//! Accès SQL à la table `library_folders`.

use rusqlite::{Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct FolderRecord {
    pub id: i64,
    pub library_id: i64,
    pub path: String,
    pub added_at: String,
}

pub fn create(conn: &Connection, library_id: i64, path: &str) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO library_folders (library_id, path, added_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![library_id, path, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_by_library(conn: &Connection, library_id: i64) -> rusqlite::Result<Vec<FolderRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, library_id, path, added_at FROM library_folders WHERE library_id = ?1 ORDER BY id",
    )?;

    let rows = stmt.query_map(rusqlite::params![library_id], |row| {
        Ok(FolderRecord {
            id: row.get(0)?,
            library_id: row.get(1)?,
            path: row.get(2)?,
            added_at: row.get(3)?,
        })
    })?;

    rows.collect()
}

/// Tous les dossiers, toutes bibliothèques confondues — utilisé par le
/// Filesystem Watcher pour retrouver à quelle bibliothèque appartient un
/// chemin qui vient de changer, sans connaître son `library_id` à l'avance.
pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<FolderRecord>> {
    let mut stmt =
        conn.prepare("SELECT id, library_id, path, added_at FROM library_folders ORDER BY id")?;

    let rows = stmt.query_map([], |row| {
        Ok(FolderRecord {
            id: row.get(0)?,
            library_id: row.get(1)?,
            path: row.get(2)?,
            added_at: row.get(3)?,
        })
    })?;

    rows.collect()
}

/// Supprime le dossier et renvoie son chemin s'il existait, pour que
/// l'appelant puisse arrêter de le surveiller (voir `commands::library`).
pub fn delete(conn: &Connection, folder_id: i64) -> rusqlite::Result<Option<String>> {
    let path: Option<String> = conn
        .query_row(
            "SELECT path FROM library_folders WHERE id = ?1",
            rusqlite::params![folder_id],
            |row| row.get(0),
        )
        .optional()?;

    conn.execute(
        "DELETE FROM library_folders WHERE id = ?1",
        rusqlite::params![folder_id],
    )?;

    Ok(path)
}
