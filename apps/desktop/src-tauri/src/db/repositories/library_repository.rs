//! Accès SQL à la table `libraries`.
//!
//! Ne contient volontairement aucune notion de disponibilité de dossier
//! (dépend du système de fichiers, pas de la base) — c'est la couche
//! `domain::library` qui combine ces données avec une vérification sur
//! disque pour produire la vue complète exposée au frontend.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LibraryRecord {
    pub id: i64,
    pub name: String,
    pub category_id: Option<i64>,
    pub icon: Option<String>,
    pub accent_color: Option<String>,
    pub sort_order: i64,
    pub folder_count: i64,
    pub media_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Crée une bibliothèque rattachée à une Catégorie (doc §6.1). `media_type`
/// (dépréciée depuis l'Étape 4, voir migration 0004) reste néanmoins
/// renseignée avec la `key` de la catégorie plutôt que laissée vide : la
/// colonne est `NOT NULL` et il est plus sain d'y laisser une valeur
/// cohérente — même si plus rien ne la lit — qu'une chaîne vide qui
/// signifierait "aucune donnée" de façon ambiguë.
pub fn create(
    conn: &Connection,
    name: &str,
    category_id: i64,
    category_key: &str,
    icon: Option<&str>,
    accent_color: Option<&str>,
) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();

    let next_sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM libraries",
        [],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO libraries (name, media_type, category_id, icon, accent_color, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        rusqlite::params![name, category_key, category_id, icon, accent_color, next_sort_order, now],
    )?;

    Ok(conn.last_insert_rowid())
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<LibraryRecord>> {
    let mut stmt = conn.prepare(
        "SELECT
            l.id, l.name, l.category_id, l.icon, l.accent_color, l.sort_order,
            (SELECT COUNT(*) FROM library_folders f WHERE f.library_id = l.id),
            (SELECT COUNT(*) FROM media_files m WHERE m.library_id = l.id),
            l.created_at, l.updated_at
         FROM libraries l
         ORDER BY l.sort_order ASC, l.id ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(LibraryRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            category_id: row.get(2)?,
            icon: row.get(3)?,
            accent_color: row.get(4)?,
            sort_order: row.get(5)?,
            folder_count: row.get(6)?,
            media_count: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;

    rows.collect()
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<LibraryRecord>> {
    conn.query_row(
        "SELECT
            l.id, l.name, l.category_id, l.icon, l.accent_color, l.sort_order,
            (SELECT COUNT(*) FROM library_folders f WHERE f.library_id = l.id),
            (SELECT COUNT(*) FROM media_files m WHERE m.library_id = l.id),
            l.created_at, l.updated_at
         FROM libraries l WHERE l.id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(LibraryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                category_id: row.get(2)?,
                icon: row.get(3)?,
                accent_color: row.get(4)?,
                sort_order: row.get(5)?,
                folder_count: row.get(6)?,
                media_count: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        },
    )
    .optional()
}

/// Bibliothèques rattachées à une Catégorie donnée — c'est ce qui permet à
/// plusieurs bibliothèques d'alimenter la même Catégorie (doc §6.1) :
/// utilisé par le Metadata Service pour savoir quels fichiers regarder
/// quand on demande "toutes les catégories" plutôt qu'une bibliothèque
/// précise, et par `domain::category` pour le comptage de Titres.
pub fn list_by_category(conn: &Connection, category_id: i64) -> rusqlite::Result<Vec<LibraryRecord>> {
    let mut stmt = conn.prepare(
        "SELECT
            l.id, l.name, l.category_id, l.icon, l.accent_color, l.sort_order,
            (SELECT COUNT(*) FROM library_folders f WHERE f.library_id = l.id),
            (SELECT COUNT(*) FROM media_files m WHERE m.library_id = l.id),
            l.created_at, l.updated_at
         FROM libraries l WHERE l.category_id = ?1
         ORDER BY l.sort_order ASC, l.id ASC",
    )?;

    let rows = stmt.query_map(rusqlite::params![category_id], |row| {
        Ok(LibraryRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            category_id: row.get(2)?,
            icon: row.get(3)?,
            accent_color: row.get(4)?,
            sort_order: row.get(5)?,
            folder_count: row.get(6)?,
            media_count: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;

    rows.collect()
}

/// Bibliothèques dont `category_id` est encore `NULL` — file de travail de
/// `db::seed::backfill_library_categories` (Étape 4, migration de
/// `media_type` texte libre vers `category_id`), avec l'ancien
/// `media_type` pour pouvoir décider vers quelle catégorie basculer
/// chacune.
pub fn list_without_category(conn: &Connection) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt =
        conn.prepare("SELECT id, media_type FROM libraries WHERE category_id IS NULL")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

pub fn set_category(conn: &Connection, library_id: i64, category_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE libraries SET category_id = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![category_id, chrono::Utc::now().to_rfc3339(), library_id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, library_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM libraries WHERE id = ?1",
        rusqlite::params![library_id],
    )?;
    Ok(())
}
