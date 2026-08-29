//! Accès SQL à la table `playback_progress`.
//!
//! Scopée par profil depuis la migration 0007 (Étape 6a, doc §6.5) : la clé
//! primaire est désormais `(profile_id, media_file_id)`. Toutes les
//! fonctions de ce module prennent donc un `profile_id` explicite — jamais
//! déduit ici (c'est `domain::playback` qui le reçoit de l'appelant, lequel
//! le lit du profil actif porté par `AppState`, jamais d'un paramètre
//! transmis librement par le frontend).

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackProgressRecord {
    pub media_file_id: i64,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub updated_at: String,
}

pub fn get(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
) -> rusqlite::Result<Option<PlaybackProgressRecord>> {
    conn.query_row(
        "SELECT media_file_id, position_seconds, duration_seconds, updated_at
         FROM playback_progress WHERE profile_id = ?1 AND media_file_id = ?2",
        rusqlite::params![profile_id, media_file_id],
        |row| {
            Ok(PlaybackProgressRecord {
                media_file_id: row.get(0)?,
                position_seconds: row.get(1)?,
                duration_seconds: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
    .optional()
}

/// Insère ou remplace la progression d'un fichier pour un profil donné
/// (une seule ligne par couple `(profile_id, media_file_id)`).
pub fn upsert(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO playback_progress (profile_id, media_file_id, position_seconds, duration_seconds, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(profile_id, media_file_id) DO UPDATE SET
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            updated_at = excluded.updated_at",
        rusqlite::params![profile_id, media_file_id, position_seconds, duration_seconds, now],
    )?;
    Ok(())
}

/// Remet la progression à zéro (fichier considéré comme terminé) pour un
/// profil donné.
pub fn clear(conn: &Connection, profile_id: i64, media_file_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM playback_progress WHERE profile_id = ?1 AND media_file_id = ?2",
        rusqlite::params![profile_id, media_file_id],
    )?;
    Ok(())
}

// ---- Rangée « Continuer à regarder » (Étape 8) -----------------------

/// Ligne brute de la rangée : progression + infos Titre/Épisode pour
/// l'affichage (jointure via `media_files.title_id` / `episode_id`,
/// schéma 0004). Seuls les médias disponibles et entre 1 % et 95 %.
#[derive(Debug, Clone, Serialize)]
pub struct ContinueWatchingRow {
    pub media_file_id: i64,
    pub path: String,
    pub library_id: i64,
    pub title_id: i64,
    pub title_name: String,
    pub kind: String,
    pub category_key: String,
    pub poster_path: Option<String>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
    pub position_seconds: f64,
    pub duration_seconds: f64,
}

pub fn list_continue_watching(
    conn: &Connection,
    profile_id: i64,
) -> rusqlite::Result<Vec<ContinueWatchingRow>> {
    let mut stmt = conn.prepare(
        "SELECT pp.media_file_id, m.path, m.library_id,
                COALESCE(t.id, et.id), COALESCE(t.name, et.name), COALESCE(t.kind, et.kind),
                c.key, COALESCE(t.poster_path, et.poster_path),
                s.season_number, e.episode_number,
                pp.position_seconds, pp.duration_seconds
         FROM playback_progress pp
         JOIN media_files m ON m.id = pp.media_file_id AND m.is_available = 1
         LEFT JOIN titles t ON t.id = m.title_id
         LEFT JOIN episodes e ON e.id = m.episode_id
         LEFT JOIN titles et ON et.id = e.title_id
         LEFT JOIN seasons s ON s.id = e.season_id
         JOIN categories c ON c.id = COALESCE(t.category_id, et.category_id)
         WHERE pp.profile_id = ?1
           AND pp.duration_seconds > 0
           AND pp.position_seconds / pp.duration_seconds BETWEEN 0.01 AND 0.95
         ORDER BY pp.updated_at DESC
         LIMIT 20",
    )?;
    let rows = stmt.query_map(rusqlite::params![profile_id], |row| {
        Ok(ContinueWatchingRow {
            media_file_id: row.get(0)?,
            path: row.get(1)?,
            library_id: row.get(2)?,
            title_id: row.get(3)?,
            title_name: row.get(4)?,
            kind: row.get(5)?,
            category_key: row.get(6)?,
            poster_path: row.get(7)?,
            season_number: row.get(8)?,
            episode_number: row.get(9)?,
            position_seconds: row.get(10)?,
            duration_seconds: row.get(11)?,
        })
    })?;
    rows.collect()
}

// ---- Time Capsule & Similaires (Étape 8) -----------------------------

/// Insère une ligne d'historique quand une session de visionnage se
/// termine (appelé par `commands::playback::record_watch`).
pub fn record_watch(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
    title_id: i64,
    kind: &str,
    category_key: &str,
    position_seconds: f64,
    duration_seconds: f64,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO watch_history
            (profile_id, media_file_id, title_id, kind, category_key,
             position_seconds, duration_seconds, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        rusqlite::params![
            profile_id,
            media_file_id,
            title_id,
            kind,
            category_key,
            position_seconds,
            duration_seconds,
            now,
        ],
    )?;
    Ok(())
}

/// Statistiques agrégées : heures totales, nombre de sessions, titres
/// uniques, genres distincts.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WatchStats {
    pub total_hours: f64,
    pub session_count: i64,
    pub unique_titles: i64,
    pub unique_genres: i64,
}

pub fn watch_stats(conn: &Connection, profile_id: i64) -> rusqlite::Result<WatchStats> {
    let (total_hours, session_count, unique_titles) = conn.query_row(
        "SELECT COALESCE(SUM(position_seconds), 0) / 3600.0,
                COUNT(*),
                COUNT(DISTINCT title_id)
         FROM watch_history
         WHERE profile_id = ?1",
        rusqlite::params![profile_id],
        |row| Ok((row.get::<_, f64>(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let unique_genres: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT tg.genre_id)
         FROM watch_history wh
         JOIN title_genres tg ON tg.title_id = wh.title_id
         WHERE wh.profile_id = ?1",
        rusqlite::params![profile_id],
        |row| row.get(0),
    )?;
    Ok(WatchStats { total_hours, session_count, unique_titles, unique_genres })
}

/// Top genres : (genre_name, session_count) des 6 genres les plus vus.
pub fn top_genres(
    conn: &Connection,
    profile_id: i64,
    limit: i64,
) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT g.name, COUNT(*)
         FROM watch_history wh
         JOIN title_genres tg ON tg.title_id = wh.title_id
         JOIN genres g ON g.id = tg.genre_id
         WHERE wh.profile_id = ?1
         GROUP BY tg.genre_id
         ORDER BY COUNT(*) DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![profile_id, limit], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?;
    rows.collect()
}

/// Top titres : (title_id, name, kind, category_key, poster, year, count)
/// des `limit` titres les plus regardés.
pub fn top_titles(
    conn: &Connection,
    profile_id: i64,
    limit: i64,
) -> rusqlite::Result<Vec<(i64, String, String, String, Option<String>, Option<i64>, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.kind, c.key, t.poster_path, t.year, COUNT(*)
         FROM watch_history wh
         JOIN titles t ON t.id = wh.title_id
         JOIN categories c ON c.id = t.category_id
         WHERE wh.profile_id = ?1
         GROUP BY wh.title_id
         ORDER BY COUNT(*) DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![profile_id, limit], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?))
    })?;
    rows.collect()
}

/// Sessions de la période [from, to) — « il y a 1 an » / top annuel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSession {
    pub title_id: i64,
    pub title_name: String,
    pub category_key: String,
    pub poster: Option<String>,
    pub position_seconds: f64,
    pub ended_at: String,
}

pub fn watch_sessions_in(
    conn: &Connection,
    profile_id: i64,
    from: &str,
    to: &str,
) -> rusqlite::Result<Vec<WatchSession>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, wh.category_key, t.poster_path, wh.position_seconds, wh.ended_at
         FROM watch_history wh
         JOIN titles t ON t.id = wh.title_id
         WHERE wh.profile_id = ?1 AND wh.ended_at >= ?2 AND wh.ended_at < ?3
         ORDER BY wh.ended_at DESC",
    )?;
    let rows = stmt.query_map(rusqlite::params![profile_id, from, to], |row| {
        Ok(WatchSession {
            title_id: row.get(0)?,
            title_name: row.get(1)?,
            category_key: row.get(2)?,
            poster: row.get(3)?,
            position_seconds: row.get(4)?,
            ended_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Similaires : score = 3×genres communs + 2×personnes (acteurs/réa)
/// communes + 1×studios communs. Exclut le titre lui-même et les
/// titres déjà marqués indisponibles.
pub fn similar_titles(
    conn: &Connection,
    title_id: i64,
    limit: i64,
) -> rusqlite::Result<Vec<(i64, i64, String, String, Option<String>, Option<i64>, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.category_id, t.kind, t.name, t.poster_path, t.year,
                (SELECT COUNT(*) FROM title_genres a
                   JOIN title_genres b ON a.genre_id = b.genre_id
                 WHERE a.title_id = t.id AND b.title_id = ?1) * 3
              + (SELECT COUNT(*) FROM title_credits a
                   JOIN title_credits b ON a.person_id = b.person_id
                 WHERE a.title_id = t.id AND b.title_id = ?1) * 2
              + (SELECT COUNT(*) FROM title_studios a
                   JOIN title_studios b ON a.studio_id = b.studio_id
                 WHERE a.title_id = t.id AND b.title_id = ?1) AS score
         FROM titles t
         WHERE t.id != ?1
         HAVING score > 0
         ORDER BY score DESC, t.rating DESC NULLS LAST
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![title_id, limit], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?))
    })?;
    rows.collect()
}