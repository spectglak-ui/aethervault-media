//! Accès SQL à la table `categories` (Étape 4, doc §6.1).
//!
//! Comme `library_repository`, ne porte aucune notion qui dépendrait
//! d'autre chose que la table elle-même — le comptage de Titres par
//! catégorie et la règle « jamais de compteur pour Privé » vivent dans
//! `domain::category`, pas ici.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CategoryRecord {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub icon: Option<String>,
    /// Bannière *automatique* (Metadata Service) uniquement — la
    /// personnalisation par l'utilisateur vit dans `custom_images` (Étape
    /// 5, doc §6.6), interrogée séparément par `domain::category`.
    pub banner_path: Option<String>,
    pub sort_order: i64,
    pub is_system: bool,
    pub created_at: String,
    pub updated_at: String,
}

const COLUMNS: &str =
    "id, key, name, icon, banner_path, sort_order, is_system, created_at, updated_at";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<CategoryRecord> {
    Ok(CategoryRecord {
        id: row.get(0)?,
        key: row.get(1)?,
        name: row.get(2)?,
        icon: row.get(3)?,
        banner_path: row.get(4)?,
        sort_order: row.get(5)?,
        is_system: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<CategoryRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM categories ORDER BY sort_order ASC, id ASC"
    ))?;
    let rows = stmt.query_map([], map_row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<CategoryRecord>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM categories WHERE id = ?1"),
        rusqlite::params![id],
        map_row,
    )
    .optional()
}

pub fn get_by_key(conn: &Connection, key: &str) -> rusqlite::Result<Option<CategoryRecord>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM categories WHERE key = ?1"),
        rusqlite::params![key],
        map_row,
    )
    .optional()
}

/// Insère une catégorie si elle n'existe pas déjà (par `key`) — utilisé par
/// `db::seed::ensure_default_categories`, idempotent par construction pour
/// pouvoir être rejoué à chaque démarrage sans dupliquer les 5 catégories
/// système.
pub fn ensure(
    conn: &Connection,
    key: &str,
    name: &str,
    icon: Option<&str>,
    sort_order: i64,
    is_system: bool,
) -> rusqlite::Result<i64> {
    if let Some(existing) = get_by_key(conn, key)? {
        return Ok(existing.id);
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO categories (key, name, icon, sort_order, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        rusqlite::params![key, name, icon, sort_order, is_system, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Nombre de Titres rattachés à une catégorie — `None` n'est jamais
/// renvoyé ici (c'est `domain::category` qui applique la règle « pas de
/// compteur pour Privé », pas ce repository).
pub fn count_titles(conn: &Connection, category_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM titles WHERE category_id = ?1",
        rusqlite::params![category_id],
        |row| row.get(0),
    )
}
