//! Accès SQL à `media_probes` (migration 0015) — sonde technique des
//! fichiers média (Étape 7, lot 2) : résolution, codec vidéo, langues
//! audio/sous-titres. Table 1-1 séparée de `media_files` pour ne toucher
//! aucune requête existante : un fichier non sondé n'a simplement pas de
//! ligne ici.
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct MediaProbeRecord {
    pub media_file_id: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub resolution: Option<String>,
    pub video_codec: Option<String>,
    pub audio_langs: Vec<String>,
    pub subtitle_langs: Vec<String>,
}

const COLUMNS: &str =
    "media_file_id, width, height, resolution, video_codec, audio_langs, subtitle_langs";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<MediaProbeRecord> {
    let audio: Vec<String> = serde_json::from_str(&row.get::<_, String>(5)?).unwrap_or_default();
    let subs: Vec<String> = serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default();
    Ok(MediaProbeRecord {
        media_file_id: row.get(0)?,
        width: row.get(1)?,
        height: row.get(2)?,
        resolution: row.get(3)?,
        video_codec: row.get(4)?,
        audio_langs: audio,
        subtitle_langs: subs,
    })
}

pub fn get(conn: &Connection, media_file_id: i64) -> rusqlite::Result<Option<MediaProbeRecord>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM media_probes WHERE media_file_id = ?1"),
        rusqlite::params![media_file_id],
        map_row,
    )
    .optional()
}

/// Fichiers d'une bibliothèque sans sonde technique — la file de travail
/// de la passe de probe (reprisable : un fichier sondé a une ligne).
pub fn unprobed_files(conn: &Connection, library_id: i64) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.path FROM media_files m
         LEFT JOIN media_probes p ON p.media_file_id = m.id
         WHERE m.library_id = ?1 AND m.is_available = 1 AND p.media_file_id IS NULL
         ORDER BY m.id",
    )?;
    let rows = stmt.query_map(rusqlite::params![library_id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

#[allow(clippy::too_many_arguments)]
pub fn upsert(
    conn: &Connection,
    media_file_id: i64,
    width: Option<i64>,
    height: Option<i64>,
    resolution: Option<&str>,
    video_codec: Option<&str>,
    audio_langs: &[String],
    subtitle_langs: &[String],
) -> rusqlite::Result<()> {
    let audio = serde_json::to_string(audio_langs).unwrap_or_else(|_| "[]".to_string());
    let subs = serde_json::to_string(subtitle_langs).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO media_probes (media_file_id, width, height, resolution, video_codec,
                                   audio_langs, subtitle_langs, probe_updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(media_file_id) DO UPDATE SET
           width = excluded.width,
           height = excluded.height,
           resolution = excluded.resolution,
           video_codec = excluded.video_codec,
           audio_langs = excluded.audio_langs,
           subtitle_langs = excluded.subtitle_langs,
           probe_updated_at = excluded.probe_updated_at",
        rusqlite::params![
            media_file_id,
            width,
            height,
            resolution,
            video_codec,
            audio,
            subs,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

// ---- Valeurs distinctes pour les filtres de l'Explorateur (lot 3) ----

pub fn distinct_resolutions(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT resolution FROM media_probes WHERE resolution IS NOT NULL
         ORDER BY CASE resolution
           WHEN '2160p' THEN 0 WHEN '1440p' THEN 1 WHEN '1080p' THEN 2
           WHEN '720p' THEN 3 WHEN 'SD' THEN 4 ELSE 5 END",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

pub fn distinct_codecs(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT video_codec FROM media_probes WHERE video_codec IS NOT NULL
         ORDER BY video_codec",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// Langues audio distinctes — le JSON est déplié côté Rust (SQLite ne
/// connaît pas `json_each` sans extension, et on n'en ajoute pas).
pub fn distinct_audio_langs(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT audio_langs FROM media_probes")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut all: Vec<String> = Vec::new();
    for row in rows {
        let langs: Vec<String> = serde_json::from_str(&row?).unwrap_or_default();
        for lang in langs {
            if !all.contains(&lang) {
                all.push(lang);
            }
        }
    }
    all.sort();
    Ok(all)
}