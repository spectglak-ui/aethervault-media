//! Segments de saut (génériques/résumés) des épisodes (0.3.0).
//! Table créée idempotemment à chaque usage (pas de migration numérotée :
//! CREATE IF NOT EXISTS) — source 'auto' (empreintes audio) ou 'manual'.
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SegmentRecord {
    pub episode_id: i64,
    pub segment_type: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub source: String,
}

pub fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS episode_segments (
            episode_id INTEGER NOT NULL,
            segment_type TEXT NOT NULL CHECK(segment_type IN ('intro','outro','recap')),
            start_seconds REAL NOT NULL,
            end_seconds REAL NOT NULL,
            source TEXT NOT NULL DEFAULT 'auto' CHECK(source IN ('auto','manual')),
            updated_at TEXT NOT NULL,
            PRIMARY KEY (episode_id, segment_type),
            FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
        );",
    )
}

pub fn list_for_episode(conn: &Connection, episode_id: i64) -> rusqlite::Result<Vec<SegmentRecord>> {
    let mut stmt = conn.prepare(
        "SELECT episode_id, segment_type, start_seconds, end_seconds, source
         FROM episode_segments WHERE episode_id = ?1 ORDER BY segment_type",
    )?;
    let rows = stmt.query_map(params![episode_id], |row| {
        Ok(SegmentRecord {
            episode_id: row.get(0)?,
            segment_type: row.get(1)?,
            start_seconds: row.get(2)?,
            end_seconds: row.get(3)?,
            source: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn get_source(conn: &Connection, episode_id: i64, segment_type: &str) -> rusqlite::Result<Option<String>> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT source FROM episode_segments WHERE episode_id = ?1 AND segment_type = ?2",
        params![episode_id, segment_type],
        |row| row.get(0),
    )
    .optional()
}

pub fn upsert(
    conn: &Connection,
    episode_id: i64,
    segment_type: &str,
    start_seconds: f64,
    end_seconds: f64,
    source: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO episode_segments (episode_id, segment_type, start_seconds, end_seconds, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(episode_id, segment_type)
         DO UPDATE SET start_seconds = excluded.start_seconds,
                       end_seconds = excluded.end_seconds,
                       source = excluded.source,
                       updated_at = excluded.updated_at",
        params![
            episode_id,
            segment_type,
            start_seconds,
            end_seconds,
            source,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, episode_id: i64, segment_type: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM episode_segments WHERE episode_id = ?1 AND segment_type = ?2",
        params![episode_id, segment_type],
    )?;
    Ok(())
}