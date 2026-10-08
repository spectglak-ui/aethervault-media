//! Commandes de la catégorie TV (0.9.0).
use crate::services::tv::{self, TvChannel};
use crate::state::AppState;
use tauri::State;

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[tauri::command]
pub fn tv_list_channels(state: State<'_, AppState>) -> Result<Vec<TvChannel>, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, url, logo_url, group_name, country, added_at
             FROM tv_channels
             ORDER BY group_name ASC NULLS LAST, name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TvChannel {
                id: row.get(0)?,
                name: row.get(1)?,
                url: row.get(2)?,
                logo_url: row.get(3)?,
                group_name: row.get(4)?,
                country: row.get(5)?,
                added_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[tauri::command]
pub fn tv_add_channel(
    state: State<'_, AppState>,
    name: String,
    url: String,
    logo_url: Option<String>,
    group_name: Option<String>,
) -> Result<i64, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO tv_channels (name, url, logo_url, group_name, country, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![name, url, logo_url, group_name, None::<String>, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn tv_remove_channel(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tv_channels WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Importe une playlist M3U (URL distante ou chemin local).
/// Les URLs déjà présentes sont ignorées (INSERT OR IGNORE).
#[tauri::command]
pub fn tv_import_m3u(
    state: State<'_, AppState>,
    source: String,
    country: Option<String>,
) -> Result<usize, String> {
    let text = tv::load_m3u(&source)?;
    let parsed = tv::parse_m3u(&text);
    if parsed.is_empty() {
        return Err("Aucune chaîne trouvée dans cette playlist.".to_string());
    }
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let mut added = 0usize;
    for ch in &parsed {
        added += conn
            .execute(
                "INSERT OR IGNORE INTO tv_channels (name, url, logo_url, group_name, country, added_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![ch.name, ch.url, ch.logo_url, ch.group_name, country, now_secs()],
            )
            .map_err(|e| e.to_string())?;
    }
    log::info!("[tv] import M3U : {} chaîne(s) ajoutée(s) sur {}", added, parsed.len());
    Ok(added)
}