//! Accès SQL à la table `player_settings` (volume, muet, vitesse de
//! lecture — voir la migration `0012_player_settings.sql`). Même patron
//! que `window_state_repository.rs` : une seule ligne (id=1), pas de
//! contenu utilisateur, juste une préférence d'interface à retrouver au
//! prochain démarrage.

use rusqlite::{Connection, OptionalExtension};

pub struct PlayerSettingsRecord {
    pub volume: f64,
    pub muted: bool,
    pub rate: f64,
}

pub fn get(conn: &Connection) -> rusqlite::Result<Option<PlayerSettingsRecord>> {
    conn.query_row(
        "SELECT volume, muted, rate FROM player_settings WHERE id = 1",
        [],
        |row| {
            Ok(PlayerSettingsRecord {
                volume: row.get(0)?,
                muted: row.get::<_, i64>(1)? != 0,
                rate: row.get(2)?,
            })
        },
    )
    .optional()
}

pub fn save(conn: &Connection, record: &PlayerSettingsRecord) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO player_settings (id, volume, muted, rate, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
            volume = excluded.volume, muted = excluded.muted, rate = excluded.rate,
            updated_at = excluded.updated_at",
        rusqlite::params![record.volume, record.muted as i64, record.rate, now],
    )?;
    Ok(())
}
