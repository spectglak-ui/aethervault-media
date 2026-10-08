//! Accès SQL de la catégorie Lecture (0.7.0) : bibliothèques, dossiers,
//! livres, progression par profil, réglages de lecture. Même précédent
//! que VaultTube : tables créées idempotemment au démarrage via
//! `ensure_tables` (pas de migration numérotée), catégorie système
//! insérée via `ensure_category`.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ReadingLibraryRecord {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub icon: Option<String>,
    pub accent_color: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadingFolderRecord {
    pub id: i64,
    pub library_id: i64,
    pub path: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadingBookRecord {
    pub id: i64,
    pub library_id: i64,
    pub folder_id: i64,
    pub path: String,
    pub file_name: String,
    pub format: String,
    pub title: String,
    pub series: Option<String>,
    pub volume: Option<i64>,
    pub chapter: Option<String>,
    pub page_count: i64,
    pub cover_path: Option<String>,
    pub size_bytes: i64,
    pub is_available: bool,
    pub modified_at: String,
    pub discovered_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadingProgressRecord {
    pub book_id: i64,
    pub current_page: i64,
    pub total_pages: i64,
    pub completed: bool,
    pub updated_at: String,
}

/// Livre + progression jointe, pour la rangée « Continuer à lire ».
#[derive(Debug, Clone, Serialize)]
pub struct ContinueReadingRecord {
    pub book: ReadingBookRecord,
    pub current_page: i64,
    pub total_pages: i64,
    pub completed: bool,
    pub updated_at: String,
}

const BOOK_COLUMNS: &str = "id, library_id, folder_id, path, file_name, format, title, \
series, volume, chapter, page_count, cover_path, size_bytes, is_available, modified_at, discovered_at";

fn map_book(row: &rusqlite::Row) -> rusqlite::Result<ReadingBookRecord> {
    Ok(ReadingBookRecord {
        id: row.get(0)?,
        library_id: row.get(1)?,
        folder_id: row.get(2)?,
        path: row.get(3)?,
        file_name: row.get(4)?,
        format: row.get(5)?,
        title: row.get(6)?,
        series: row.get(7)?,
        volume: row.get(8)?,
        chapter: row.get(9)?,
        page_count: row.get(10)?,
        cover_path: row.get(11)?,
        size_bytes: row.get(12)?,
        is_available: row.get(13)?,
        modified_at: row.get(14)?,
        discovered_at: row.get(15)?,
    })
}

/// Schéma idempotent — appelé une fois au démarrage (`lib.rs`), comme
/// `VaultTubeRepository::create_tables`.
pub fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS reading_libraries (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            kind         TEXT NOT NULL DEFAULT 'manga',
            icon         TEXT,
            accent_color TEXT,
            sort_order   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reading_folders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            library_id INTEGER NOT NULL REFERENCES reading_libraries(id) ON DELETE CASCADE,
            path       TEXT NOT NULL UNIQUE,
            added_at   TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reading_books (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            library_id    INTEGER NOT NULL REFERENCES reading_libraries(id) ON DELETE CASCADE,
            folder_id     INTEGER NOT NULL REFERENCES reading_folders(id) ON DELETE CASCADE,
            path          TEXT NOT NULL UNIQUE,
            file_name     TEXT NOT NULL,
            format        TEXT NOT NULL,
            title         TEXT NOT NULL,
            series        TEXT,
            volume        INTEGER,
            chapter       TEXT,
            page_count    INTEGER NOT NULL DEFAULT 0,
            cover_path    TEXT,
            size_bytes    INTEGER NOT NULL DEFAULT 0,
            is_available  INTEGER NOT NULL DEFAULT 1,
            modified_at   TEXT NOT NULL,
            discovered_at TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reading_progress (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id   INTEGER NOT NULL,
            book_id      INTEGER NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
            current_page INTEGER NOT NULL DEFAULT 0,
            total_pages  INTEGER NOT NULL DEFAULT 0,
            completed    INTEGER NOT NULL DEFAULT 0,
            updated_at   TEXT NOT NULL,
            UNIQUE(profile_id, book_id)
        );
        CREATE TABLE IF NOT EXISTS reading_settings (
            profile_id    INTEGER PRIMARY KEY,
            settings_json TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reading_books_library ON reading_books(library_id);
        CREATE INDEX IF NOT EXISTS idx_reading_progress_profile ON reading_progress(profile_id, updated_at DESC);
        ",
    )
}

/// Catégorie système « Lecture » — INSERT OR IGNORE : rejouer cette
/// fonction sur une base existante ne crée jamais de doublon.
pub fn ensure_category(conn: &Connection) -> rusqlite::Result<()> {
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) FROM categories WHERE key = 'reading'",
        [],
        |r| r.get::<_, i64>(0),
    )? > 0;
    if exists {
        return Ok(());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO categories (key, name, icon, sort_order, is_system, created_at, updated_at)
         VALUES ('reading', 'Lecture', 'BookOpen', ?1, 1, ?2, ?2)",
        params![next_sort, now],
    )?;
    Ok(())
}

// --- Bibliothèques -----------------------------------------------------

pub fn create_library(conn: &Connection, name: &str, kind: &str) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM reading_libraries",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO reading_libraries (name, kind, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![name, kind, next_sort, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_libraries(conn: &Connection) -> rusqlite::Result<Vec<ReadingLibraryRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, kind, icon, accent_color, sort_order, created_at, updated_at
         FROM reading_libraries ORDER BY sort_order ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ReadingLibraryRecord {
            id: r.get(0)?,
            name: r.get(1)?,
            kind: r.get(2)?,
            icon: r.get(3)?,
            accent_color: r.get(4)?,
            sort_order: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn rename_library(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE reading_libraries SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now, id],
    )?;
    Ok(())
}

pub fn delete_library(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM reading_libraries WHERE id = ?1", params![id])?;
    Ok(())
}

// --- Dossiers ----------------------------------------------------------

pub fn create_folder(conn: &Connection, library_id: i64, path: &str) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO reading_folders (library_id, path, added_at) VALUES (?1, ?2, ?3)",
        params![library_id, path, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_folders_by_library(conn: &Connection, library_id: i64) -> rusqlite::Result<Vec<ReadingFolderRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, library_id, path, added_at FROM reading_folders WHERE library_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(params![library_id], |r| {
        Ok(ReadingFolderRecord { id: r.get(0)?, library_id: r.get(1)?, path: r.get(2)?, added_at: r.get(3)? })
    })?;
    rows.collect()
}

pub fn delete_folder(conn: &Connection, folder_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM reading_folders WHERE id = ?1", params![folder_id])?;
    Ok(())
}

// --- Livres ------------------------------------------------------------

pub struct NewBookData<'a> {
    pub path: &'a str,
    pub file_name: &'a str,
    pub format: &'a str,
    pub title: &'a str,
    pub page_count: i64,
    pub cover_path: Option<&'a str>,
    pub size_bytes: i64,
    pub modified_at: &'a str,
}

/// Insère ou met à jour par chemin exact — même contrat que les autres
/// scanners : renvoie (id, était_nouveau).
pub fn upsert_book(
    conn: &Connection,
    library_id: i64,
    folder_id: i64,
    data: &NewBookData,
) -> rusqlite::Result<(i64, bool)> {
    let now = chrono::Utc::now().to_rfc3339();
    let existing: Option<i64> = conn
        .query_row("SELECT id FROM reading_books WHERE path = ?1", params![data.path], |r| r.get(0))
        .optional()?;
    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE reading_books SET page_count = ?1, cover_path = ?2, size_bytes = ?3,
                 modified_at = ?4, is_available = 1, updated_at = ?5 WHERE id = ?6",
                params![data.page_count, data.cover_path, data.size_bytes, data.modified_at, now, id],
            )?;
            Ok((id, false))
        }
        None => {
            conn.execute(
                "INSERT INTO reading_books
                    (library_id, folder_id, path, file_name, format, title, page_count,
                     cover_path, size_bytes, is_available, modified_at, discovered_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11, ?11)",
                params![
                    library_id, folder_id, data.path, data.file_name, data.format, data.title,
                    data.page_count, data.cover_path, data.size_bytes, data.modified_at, now
                ],
            )?;
            Ok((conn.last_insert_rowid(), true))
        }
    }
}

pub fn list_books_by_library(conn: &Connection, library_id: i64) -> rusqlite::Result<Vec<ReadingBookRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {BOOK_COLUMNS} FROM reading_books WHERE library_id = ?1 ORDER BY title COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(params![library_id], map_book)?;
    rows.collect()
}

pub fn get_book(conn: &Connection, book_id: i64) -> rusqlite::Result<Option<ReadingBookRecord>> {
    conn.query_row(&format!("SELECT {BOOK_COLUMNS} FROM reading_books WHERE id = ?1"), params![book_id], map_book).optional()
}

pub fn mark_missing_books(conn: &Connection, folder_id: i64, seen_paths: &std::collections::HashSet<String>) -> rusqlite::Result<u64> {
    let mut stmt = conn.prepare("SELECT id, path FROM reading_books WHERE folder_id = ?1")?;
    let known: Vec<(i64, String)> = stmt
        .query_map(params![folder_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut removed = 0u64;
    for (id, path) in known {
        if !seen_paths.contains(&path) {
            conn.execute("DELETE FROM reading_books WHERE id = ?1", params![id])?;
            removed += 1;
        }
    }
    Ok(removed)
}

// --- Progression & réglages ---------------------------------------------

pub fn get_progress(conn: &Connection, profile_id: i64, book_id: i64) -> rusqlite::Result<Option<ReadingProgressRecord>> {
    conn.query_row(
        "SELECT book_id, current_page, total_pages, completed, updated_at
         FROM reading_progress WHERE profile_id = ?1 AND book_id = ?2",
        params![profile_id, book_id],
        |r| Ok(ReadingProgressRecord { book_id: r.get(0)?, current_page: r.get(1)?, total_pages: r.get(2)?, completed: r.get(3)?, updated_at: r.get(4)? }),
    ).optional()
}

pub fn upsert_progress(
    conn: &Connection,
    profile_id: i64,
    book_id: i64,
    current_page: i64,
    total_pages: i64,
    completed: bool,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO reading_progress (profile_id, book_id, current_page, total_pages, completed, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(profile_id, book_id) DO UPDATE SET
           current_page = excluded.current_page,
           total_pages  = excluded.total_pages,
           completed    = excluded.completed,
           updated_at   = excluded.updated_at",
        params![profile_id, book_id, current_page, total_pages, completed as i64, now],
    )?;
    Ok(())
}

pub fn list_continue(conn: &Connection, profile_id: i64, limit: i64) -> rusqlite::Result<Vec<ContinueReadingRecord>> {
    let mut stmt = conn.prepare(
        "SELECT b.id, b.library_id, b.folder_id, b.path, b.file_name, b.format, b.title,
                b.series, b.volume, b.chapter, b.page_count, b.cover_path, b.size_bytes,
                b.is_available, b.modified_at, b.discovered_at,
                p.current_page, p.total_pages, p.completed, p.updated_at
         FROM reading_progress p JOIN reading_books b ON b.id = p.book_id
         WHERE p.profile_id = ?1 AND p.completed = 0
         ORDER BY p.updated_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![profile_id, limit], |r| {
        Ok(ContinueReadingRecord {
            book: ReadingBookRecord {
                id: r.get(0)?, library_id: r.get(1)?, folder_id: r.get(2)?, path: r.get(3)?,
                file_name: r.get(4)?, format: r.get(5)?, title: r.get(6)?, series: r.get(7)?,
                volume: r.get(8)?, chapter: r.get(9)?, page_count: r.get(10)?, cover_path: r.get(11)?,
                size_bytes: r.get(12)?, is_available: r.get(13)?, modified_at: r.get(14)?, discovered_at: r.get(15)?,
            },
            current_page: r.get(16)?,
            total_pages: r.get(17)?,
            completed: r.get(18)?,
            updated_at: r.get(19)?,
        })
    })?;
    rows.collect()
}

pub fn get_settings(conn: &Connection, profile_id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT settings_json FROM reading_settings WHERE profile_id = ?1",
        params![profile_id],
        |r| r.get(0),
    ).optional()
}

pub fn save_settings(conn: &Connection, profile_id: i64, json: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO reading_settings (profile_id, settings_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(profile_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at",
        params![profile_id, json, now],
    )?;
    Ok(())
}
// --- Réinitialisation de progression (0.7.2) ---------------------------

/// Supprime la progression d'un livre pour le profil actif — le livre
/// quitte la rangée « Continuer à lire » (la requête fait un JOIN sur
/// `reading_progress`) et repartira page 1 la prochaine fois qu'il sera
/// ouvert (car `get_progress` renverra `None`).
pub fn delete_progress(conn: &Connection, profile_id: i64, book_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM reading_progress WHERE profile_id = ?1 AND book_id = ?2",
        params![profile_id, book_id],
    )?;
    Ok(())
}

/// Supprime TOUTES les progressions du profil actif — purge la rangée
/// « Continuer à lire » d'un seul coup.
pub fn delete_all_progress(conn: &Connection, profile_id: i64) -> rusqlite::Result<u64> {
    let removed = conn.execute(
        "DELETE FROM reading_progress WHERE profile_id = ?1",
        params![profile_id],
    )?;
    Ok(removed as u64)
}