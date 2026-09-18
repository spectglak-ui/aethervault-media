//! Accès SQL à la table `seasons` — n'existe que pour un Titre de nature
//! `"series"` (doc §6.3). Aucune vérification de la nature du Titre ici :
//! c'est au Metadata Service (seul appelant en écriture) de ne jamais
//! créer de Saison pour un Titre `"movie"`.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SeasonRecord {
    pub id: i64,
    pub title_id: i64,
    pub season_number: i64,
    pub name: Option<String>,
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<SeasonRecord> {
    Ok(SeasonRecord {
        id: row.get(0)?,
        title_id: row.get(1)?,
        season_number: row.get(2)?,
        name: row.get(3)?,
    })
}

pub fn list_by_title(conn: &Connection, title_id: i64) -> rusqlite::Result<Vec<SeasonRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, title_id, season_number, name FROM seasons
         WHERE title_id = ?1 ORDER BY season_number ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![title_id], map_row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<SeasonRecord>> {
    conn.query_row(
        "SELECT id, title_id, season_number, name FROM seasons WHERE id = ?1",
        rusqlite::params![id],
        map_row,
    )
    .optional()
}

/// Nombre d'épisodes d'une Saison — utilisé pour l'affichage (doc §6.3,
/// page Série) sans avoir à charger la liste complète des épisodes.
pub fn count_episodes(conn: &Connection, season_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM episodes WHERE season_id = ?1",
        rusqlite::params![season_id],
        |row| row.get(0),
    )
}

/// Recherche-ou-création par numéro de saison — point d'entrée principal
/// utilisé par le Metadata Service, même logique que
/// `title_repository::find_or_create`.
pub fn find_or_create(
    conn: &Connection,
    title_id: i64,
    season_number: i64,
) -> rusqlite::Result<i64> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM seasons WHERE title_id = ?1 AND season_number = ?2",
            rusqlite::params![title_id, season_number],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO seasons (title_id, season_number, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![title_id, season_number, now],
    )?;
    Ok(conn.last_insert_rowid())
}
