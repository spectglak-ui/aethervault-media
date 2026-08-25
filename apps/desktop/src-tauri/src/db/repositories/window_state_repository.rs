//! Accès SQL à la table `player_window_state`. Coordonnées en pixels
//! logiques — voir `commands::window` pour la conversion physique/logique
//! via `Monitor::scale_factor()`/`WebviewWindow::scale_factor()`.

use rusqlite::{Connection, OptionalExtension};

pub struct WindowStateRecord {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn get(conn: &Connection) -> rusqlite::Result<Option<WindowStateRecord>> {
    conn.query_row(
        "SELECT x, y, width, height FROM player_window_state WHERE id = 1",
        [],
        |row| {
            Ok(WindowStateRecord {
                x: row.get(0)?,
                y: row.get(1)?,
                width: row.get(2)?,
                height: row.get(3)?,
            })
        },
    )
    .optional()
}

pub fn save(conn: &Connection, record: &WindowStateRecord) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO player_window_state (id, x, y, width, height, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            x = excluded.x, y = excluded.y, width = excluded.width, height = excluded.height,
            updated_at = excluded.updated_at",
        rusqlite::params![record.x, record.y, record.width, record.height, now],
    )?;
    Ok(())
}
