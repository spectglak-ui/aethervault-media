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
