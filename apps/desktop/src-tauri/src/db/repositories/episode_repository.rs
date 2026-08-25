//! Accès SQL à la table `episodes` — n'existe que pour un Titre de nature
//! `"series"` (doc §6.3).

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct EpisodeRecord {
    pub id: i64,
    pub title_id: i64,
    pub season_id: i64,
    pub episode_number: i64,
    pub name: Option<String>,
    pub description: Option<String>,
    pub duration_seconds: Option<i64>,
    pub still_path: Option<String>,
}

const COLUMNS: &str =
    "id, title_id, season_id, episode_number, name, description, duration_seconds, still_path";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<EpisodeRecord> {
    Ok(EpisodeRecord {
        id: row.get(0)?,
        title_id: row.get(1)?,
        season_id: row.get(2)?,
        episode_number: row.get(3)?,
        name: row.get(4)?,
        description: row.get(5)?,
        duration_seconds: row.get(6)?,
        still_path: row.get(7)?,
    })
}

pub fn list_by_season(conn: &Connection, season_id: i64) -> rusqlite::Result<Vec<EpisodeRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM episodes WHERE season_id = ?1 ORDER BY episode_number ASC"
    ))?;
    let rows = stmt.query_map(rusqlite::params![season_id], map_row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<EpisodeRecord>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM episodes WHERE id = ?1"),
        rusqlite::params![id],
        map_row,
    )
    .optional()
}

/// Recherche-ou-création par numéro d'épisode au sein d'une saison — même
/// logique que les autres `find_or_create` de ce module Étape 4.
pub fn find_or_create(
    conn: &Connection,
    title_id: i64,
    season_id: i64,
    episode_number: i64,
) -> rusqlite::Result<i64> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM episodes WHERE season_id = ?1 AND episode_number = ?2",
            rusqlite::params![season_id, episode_number],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO episodes (title_id, season_id, episode_number, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![title_id, season_id, episode_number, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Identifiant du Média rattaché à cet épisode, s'il existe — un épisode
/// détecté par le Metadata Service avant que son fichier ne soit lié
/// (impossible dans le flux actuel, mais reste défensif) renverrait `None`
/// plutôt que d'échouer.
pub fn media_file_id(conn: &Connection, episode_id: i64) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM media_files WHERE episode_id = ?1",
        rusqlite::params![episode_id],
        |row| row.get(0),
    )
    .optional()
}

/// Parmi `episode_ids`, ceux qui n'ont plus aucun Média associé — utilisé
/// par `domain::library::delete_library` (Étape 5), avant de vérifier si
/// le Titre parent lui-même est devenu orphelin (voir
/// `title_repository::orphaned`, qui doit être appelée APRÈS celle-ci :
/// le statut d'orphelin d'un Titre dépend du nombre d'Épisodes qui lui
/// restent une fois les épisodes orphelins déjà supprimés).
pub fn orphaned(conn: &Connection, episode_ids: &[i64]) -> rusqlite::Result<Vec<i64>> {
    let mut orphans = Vec::new();
    for &episode_id in episode_ids {
        let remaining: i64 = conn.query_row(
            "SELECT COUNT(*) FROM media_files WHERE episode_id = ?1",
            rusqlite::params![episode_id],
            |row| row.get(0),
        )?;
        if remaining == 0 {
            orphans.push(episode_id);
        }
    }
    Ok(orphans)
}

/// Supprime un Épisode déjà confirmé orphelin (voir `orphaned` ci-dessus).
/// Ne supprime jamais la Saison ni le Titre parent, même si cet épisode
/// était le dernier de sa saison — une Saison sans épisode reste une
/// limitation connue plutôt qu'un cas géré : voir la documentation
/// technique, §8, Étape 5.
pub fn delete(conn: &Connection, episode_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM episodes WHERE id = ?1", rusqlite::params![episode_id])?;
    Ok(())
}
