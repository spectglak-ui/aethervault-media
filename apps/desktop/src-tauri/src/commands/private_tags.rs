//! Tags des médias privés (0.6.3) — commandes Tauri. Comme toutes les
//! commandes `private_*` : coffre déverrouillé exigé (le Rust reste la
//! seule autorité, voir `domain::privacy`).
//!
//! 0.6.5 (correctif persistance) : chaque écriture (ajout/retrait/
//! suppression de tag) appelle désormais `persist_if_unlocked()` — sans
//! cela les tags n'existaient que dans la connexion SQLite EN MÉMOIRE et
//! disparaissaient au verrouillage ou au redémarrage (vault.db n'étant
//! ré-écrit que par persist()).
use crate::db::repositories::private_tag_repository;
use crate::domain::privacy;
use crate::state::AppState;
use serde::Serialize;

#[derive(Serialize)]
pub struct PrivateTagDto {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

#[derive(Serialize)]
pub struct PrivateMediaTagDto {
    pub media_id: i64,
    pub tag_id: i64,
    pub name: String,
}

fn with_vault<T>(
    state: &tauri::State<'_, AppState>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    let conn = privacy::require_unlocked_connection(&guard)?;
    f(conn)
}

/// Ré-écrit `vault.db` chiffré avec l'état en mémoire (no-op si verrouillé).
fn persist_vault(state: &tauri::State<'_, AppState>) -> Result<(), String> {
    let guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    guard.persist_if_unlocked()
}

fn clean_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Nom de tag vide.".to_string());
    }
    if trimmed.len() > 40 {
        return Err("Tag trop long (40 caractères max).".to_string());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub fn private_list_tags(state: tauri::State<AppState>) -> Result<Vec<PrivateTagDto>, String> {
    with_vault(&state, |conn| {
        private_tag_repository::list_tags(conn)
            .map_err(|e| e.to_string())
            .map(|rows| {
                rows.into_iter()
                    .map(|r| PrivateTagDto { id: r.0, name: r.1, count: r.2 })
                    .collect()
            })
    })
}

#[tauri::command]
pub fn private_tags_for_media(
    state: tauri::State<AppState>,
    kind: String,
    media_ids: Vec<i64>,
) -> Result<Vec<PrivateMediaTagDto>, String> {
    with_vault(&state, |conn| {
        private_tag_repository::tags_for_many(conn, &kind, &media_ids).map(|rows| {
            rows.into_iter()
                .map(|r| PrivateMediaTagDto { media_id: r.0, tag_id: r.1, name: r.2 })
                .collect()
        })
    })
}

#[tauri::command]
pub fn private_add_tag(
    state: tauri::State<AppState>,
    kind: String,
    media_id: i64,
    name: String,
) -> Result<PrivateTagDto, String> {
    let clean = clean_name(&name)?;
    let dto = with_vault(&state, |conn| {
        let tag_id = private_tag_repository::add_tag(conn, &kind, media_id, &clean)?;
        Ok(PrivateTagDto { id: tag_id, name: clean.clone(), count: 1 })
    })?;
    persist_vault(&state)?;
    Ok(dto)
}

#[tauri::command]
pub fn private_remove_tag(
    state: tauri::State<AppState>,
    kind: String,
    media_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    with_vault(&state, |conn| {
        private_tag_repository::remove_tag(conn, &kind, media_id, tag_id)
    })?;
    persist_vault(&state)?;
    Ok(())
}

#[tauri::command]
pub fn private_delete_tag(state: tauri::State<AppState>, tag_id: i64) -> Result<(), String> {
    with_vault(&state, |conn| private_tag_repository::delete_tag(conn, tag_id))?;
    persist_vault(&state)?;
    Ok(())
}