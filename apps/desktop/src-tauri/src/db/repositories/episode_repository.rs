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

/// Épisodes d'une bibliothèque ayant un fichier média rattaché mais
/// aucune vignette — cibles de la génération automatique (Étape 6d).
pub fn missing_still_paths(
    conn: &Connection,
    library_id: i64,
) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, mf.path FROM episodes e
         JOIN media_files mf ON mf.episode_id = e.id
         WHERE mf.library_id = ?1 AND (e.still_path IS NULL OR e.still_path = '')
         ORDER BY e.id ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![library_id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

/// Chemins des vignettes déjà enregistrées pour les épisodes d'une bibliothèque (contrôle
/// des vignettes noires, voir `services::episode_thumbnails::repair_dark_stills`).
pub fn list_still_paths(
    conn: &Connection,
    library_id: i64,
) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.still_path FROM episodes e
         JOIN media_files mf ON mf.episode_id = e.id
         WHERE mf.library_id = ?1 AND e.still_path IS NOT NULL AND e.still_path <> ''
         ORDER BY e.id ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![library_id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

/// Retire la vignette d'un épisode : il redevient une cible de `missing_still_paths`.
pub fn clear_still_path(conn: &Connection, episode_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE episodes SET still_path = NULL WHERE id = ?1",
        rusqlite::params![episode_id],
    )?;
    Ok(())
}

/// Enregistre le chemin de la vignette générée (Étape 6d).
pub fn update_still_path(conn: &Connection, episode_id: i64, still_path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE episodes SET still_path = ?1 WHERE id = ?2",
        rusqlite::params![still_path, episode_id],
    )?;
    Ok(())
}
#[cfg(test)]
mod stills_tests {
    use super::*;
    use crate::db::migrations::MIGRATIONS;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             CREATE TABLE vaulttube_subscriptions (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_videos (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_playlists (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_user_playlists (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_user_playlist_items (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        for m in MIGRATIONS {
            conn.execute_batch(m.sql).unwrap_or_else(|e| panic!("migration {} : {e}", m.version));
        }
        conn
    }

    /// Série 10, saison 1 ; épisode `n` rattaché au fichier 100+n de la bibliothèque `library`.
    fn add_episode(conn: &Connection, n: i64, library: i64, still: Option<&str>) {
        if n == 1 {
            conn.execute(
                "INSERT INTO titles (id, category_id, kind, name, created_at, updated_at)
                 VALUES (10, 1, 'series', 'Serie', 'x', 'x')",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO seasons (id, title_id, season_number, created_at) VALUES (1, 10, 1, 'x')", [])
                .unwrap();
        }
        conn.execute(
            "INSERT INTO episodes (id, title_id, season_id, episode_number, created_at, still_path)
             VALUES (?1, 10, 1, ?1, 'x', ?2)",
            rusqlite::params![n, still],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO media_files (id, library_id, folder_id, path, file_name, size_bytes,
                                      modified_at, discovered_at, updated_at, episode_id)
             VALUES (?1, ?2, 1, ?3, 'f', 1, 'x', 'x', 'x', ?4)",
            rusqlite::params![100 + n, library, format!("/m/{n}.mkv"), n],
        )
        .unwrap();
    }

    #[test]
    fn les_vignettes_enregistrees_sont_listees_par_bibliotheque() {
        let conn = setup();
        add_episode(&conn, 1, 1, Some("/data/thumbnails/episodes/episode_1.jpg"));
        add_episode(&conn, 2, 1, None);
        add_episode(&conn, 3, 1, Some(""));
        add_episode(&conn, 4, 2, Some("/data/thumbnails/episodes/episode_4.jpg"));
        let lib1 = list_still_paths(&conn, 1).unwrap();
        assert_eq!(lib1, vec![(1, "/data/thumbnails/episodes/episode_1.jpg".to_string())]);
        let lib2 = list_still_paths(&conn, 2).unwrap();
        assert_eq!(lib2.len(), 1);
        assert_eq!(lib2[0].0, 4);
    }

    #[test]
    fn retirer_une_vignette_la_remet_dans_les_manquantes() {
        let conn = setup();
        add_episode(&conn, 1, 1, Some("/data/thumbnails/episodes/episode_1.jpg"));
        let missing_before: Vec<i64> = missing_still_paths(&conn, 1).unwrap().into_iter().map(|m| m.0).collect();
        assert!(!missing_before.contains(&1), "déjà pourvue : pas à générer");
        clear_still_path(&conn, 1).unwrap();
        let missing_after: Vec<i64> = missing_still_paths(&conn, 1).unwrap().into_iter().map(|m| m.0).collect();
        assert!(missing_after.contains(&1), "retirée : à régénérer");
        assert!(list_still_paths(&conn, 1).unwrap().is_empty());
    }
}
