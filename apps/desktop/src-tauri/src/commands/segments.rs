//! Commandes des segments de saut (0.3.0) : lecture/écriture manuelle +
//! détection automatique d'intro/outro par empreintes audio (service
//! intro_detector), en tâche de fond avec progression.
use crate::db::repositories::segment_repository;
use crate::db::repositories::segment_repository::SegmentRecord;
use crate::services::intro_detector;
use crate::state::AppState;
use tauri::{AppHandle, Emitter, State};

fn ensure(conn: &rusqlite::Connection) -> Result<(), String> {
    segment_repository::ensure_table(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_episode_segments(
    state: State<AppState>,
    episode_id: i64,
) -> Result<Vec<SegmentRecord>, String> {
    let conn = state.get_conn()?;
    ensure(&conn)?;
    segment_repository::list_for_episode(&conn, episode_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_episode_segment(
    state: State<AppState>,
    episode_id: i64,
    segment_type: String,
    start_seconds: f64,
    end_seconds: f64,
) -> Result<(), String> {
    if !matches!(segment_type.as_str(), "intro" | "outro" | "recap") {
        return Err("Type de segment invalide.".to_string());
    }
    if end_seconds <= start_seconds {
        return Err("Fin du segment avant son début.".to_string());
    }
    let conn = state.get_conn()?;
    ensure(&conn)?;
    segment_repository::upsert(&conn, episode_id, &segment_type, start_seconds, end_seconds, "manual")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_episode_segment(
    state: State<AppState>,
    episode_id: i64,
    segment_type: String,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    ensure(&conn)?;
    segment_repository::delete(&conn, episode_id, &segment_type).map_err(|e| e.to_string())
}

/// Détection automatique des génériques d'une série (0.3.0) : tâche de
/// fond, ne remplace JAMAIS un segment manuel, progression émise sur
/// `credits:progress`, fin sur `credits:done`.
#[tauri::command]
pub fn detect_credits(app: AppHandle, state: State<AppState>, title_id: i64) -> Result<(), String> {
    let pool = state.db_pool.clone();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let done_emit = |found: u32| {
                let _ = app.emit(
                    "credits:done",
                    serde_json::json!({ "title_id": title_id, "found": found }),
                );
            };
            let Ok(conn) = pool.get() else {
                done_emit(0);
                return;
            };
            let _ = segment_repository::ensure_table(&conn);
            // 0.3.0 : plus de lecture de mf.duration_seconds (colonne
            // absente) — la durée vient désormais de l'empreinte audio.
                        // 0.3.0 : la relation épisode→fichier est portée par
            // media_files.episode_id (résolue via le dépôt — il n'y a PAS
            // de colonne episodes.media_file_id).
                        let episode_ids: Vec<i64> = {
                let mut stmt = match conn.prepare(
                    "SELECT e.id
                     FROM episodes e
                     JOIN seasons s ON s.id = e.season_id
                     WHERE s.title_id = ?1
                     ORDER BY e.id",
                ) {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!("[credits] requête épisodes impossible : {e}");
                        done_emit(0);
                        return;
                    }
                };
                let result = stmt.query_map(rusqlite::params![title_id], |row| row.get::<_, i64>(0));
                match result {
                    Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
                    Err(e) => {
                        log::error!("[credits] lecture épisodes impossible : {e}");
                        done_emit(0);
                        return;
                    }
                }
            };
            use rusqlite::OptionalExtension;
            let mut episodes: Vec<(i64, String)> = Vec::new();
            for episode_id in episode_ids {
                let media_file_id = match crate::db::repositories::episode_repository::media_file_id(
                    &conn,
                    episode_id,
                ) {
                    Ok(Some(id)) => id,
                    _ => continue,
                };
                let path: Option<String> = conn
                    .query_row(
                        "SELECT path FROM media_files WHERE id = ?1",
                        rusqlite::params![media_file_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .ok()
                    .flatten();
                if let Some(path) = path {
                    episodes.push((episode_id, path));
                }
            }
            if episodes.len() < 2 {
                log::info!("[credits] titre {title_id} : moins de 2 épisodes, rien à analyser.");
                done_emit(0);
                return;
            }
            log::info!(
                "[credits] titre {title_id} : {} épisode(s) à analyser.",
                episodes.len()
            );
            let found = intro_detector::detect_series(&episodes, |done, total, current| {
                let _ = app.emit(
                    "credits:progress",
                    serde_json::json!({
                        "title_id": title_id,
                        "processed": done,
                        "total": total,
                        "current": current
                    }),
                );
            });
            let mut saved = 0u32;
            for (episode_id, kind, start, end) in found {
                // Ne jamais écraser un segment manuel.
                let existing = segment_repository::get_source(&conn, episode_id, kind)
                    .ok()
                    .flatten();
                if existing.as_deref() == Some("manual") {
                    continue;
                }
                if segment_repository::upsert(&conn, episode_id, kind, start, end, "auto").is_ok()
                {
                    saved += 1;
                }
            }
            log::info!("[credits] titre {title_id} : {saved} segment(s) auto enregistré(s).");
            done_emit(saved);
        }));
        if result.is_err() {
            log::error!("[credits] panic pendant la détection du titre {title_id}.");
            let _ = app.emit(
                "credits:done",
                serde_json::json!({ "title_id": title_id, "found": 0 }),
            );
        }
    });
    Ok(())
}
/// Contexte segments d'un média en lecture (0.3.0) : retrouve l'épisode
/// à partir du fichier média + ses segments — le frontend n'a pas
/// l'episode_id sous la main pendant la lecture.
#[derive(serde::Serialize)]
pub struct MediaSegmentContext {
    pub episode_id: Option<i64>,
    pub segments: Vec<SegmentRecord>,
}

#[tauri::command]
pub fn get_media_segment_context(
    state: State<AppState>,
    media_file_id: i64,
) -> Result<MediaSegmentContext, String> {
    use rusqlite::OptionalExtension;
    let conn = state.get_conn()?;
    ensure(&conn)?;
        let episode_id: Option<i64> = conn
        .query_row(
            "SELECT episode_id FROM media_files WHERE id = ?1",
            rusqlite::params![media_file_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let segments = match episode_id {
        Some(id) => segment_repository::list_for_episode(&conn, id).map_err(|e| e.to_string())?,
        None => Vec::new(),
    };
    Ok(MediaSegmentContext { episode_id, segments })
}