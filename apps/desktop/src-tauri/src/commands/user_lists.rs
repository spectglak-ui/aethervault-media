//! Notes personnelles (demi-étoiles) et Watchlist — PAR PROFIL (migration 0026).
//!
//! Distinct des Collections (listes globales et libres, `commands/title.rs`).
//! Toutes les commandes agissent sur le profil actif.

use serde::Serialize;

use crate::db::repositories::{custom_image_repository, user_list_repository as repo};
use crate::domain::title::TitleSummary;
use crate::state::AppState;

/// Note et statut de watchlist d'un titre pour le profil actif.
#[derive(Debug, Clone, Serialize)]
pub struct TitleUserState {
    pub title_id: i64,
    pub rating: Option<f64>,
    pub watch_status: Option<String>,
}

/// Entrée de la watchlist : le titre, son statut, sa date d'ajout et la note.
#[derive(Debug, Clone, Serialize)]
pub struct WatchlistEntry {
    pub title: TitleSummary,
    pub status: String,
    pub added_at: String,
    pub rating: Option<f64>,
}

fn validate_status(status: &str) -> Result<(), String> {
    if repo::WATCH_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(format!("Statut de watchlist inconnu : {status}"))
    }
}

/// Pose la note d'un titre (0,5 à 5 par pas de 0,5) ; `null` retire la note.
#[tauri::command]
pub fn set_title_rating(
    state: tauri::State<AppState>,
    title_id: i64,
    rating: Option<f64>,
) -> Result<(), String> {
    if let Some(value) = rating {
        if !repo::is_valid_rating(value) {
            return Err("La note doit être comprise entre 0,5 et 5 par pas de 0,5.".to_string());
        }
    }
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    repo::set_rating(&conn, profile_id, title_id, rating).map_err(|e| e.to_string())
}

/// Note et statut de watchlist d'UN titre.
#[tauri::command]
pub fn get_title_user_state(
    state: tauri::State<AppState>,
    title_id: i64,
) -> Result<TitleUserState, String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    let (rating, watch_status) =
        repo::user_state(&conn, profile_id, title_id).map_err(|e| e.to_string())?;
    Ok(TitleUserState { title_id, rating, watch_status })
}

/// Notes et statuts de PLUSIEURS titres en une requête (grilles d'affiches).
/// Seuls les titres notés ou présents dans la watchlist sont renvoyés.
#[tauri::command]
pub fn list_title_user_states(
    state: tauri::State<AppState>,
    title_ids: Vec<i64>,
) -> Result<Vec<TitleUserState>, String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    let rows = repo::user_states(&conn, profile_id, &title_ids).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(title_id, rating, watch_status)| TitleUserState { title_id, rating, watch_status })
        .collect())
}

#[tauri::command]
pub fn watchlist_add(state: tauri::State<AppState>, title_id: i64) -> Result<(), String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    repo::watchlist_add(&conn, profile_id, title_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn watchlist_remove(state: tauri::State<AppState>, title_id: i64) -> Result<(), String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    repo::watchlist_remove(&conn, profile_id, title_id).map_err(|e| e.to_string())
}

/// Change le statut (`todo` | `in_progress` | `done`) ; ajoute le titre à la
/// watchlist s'il n'y était pas.
#[tauri::command]
pub fn watchlist_set_status(
    state: tauri::State<AppState>,
    title_id: i64,
    status: String,
) -> Result<(), String> {
    validate_status(&status)?;
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    repo::watchlist_set_status(&conn, profile_id, title_id, &status).map_err(|e| e.to_string())
}

/// Watchlist du profil actif, filtrable par catégorie et par statut.
#[tauri::command]
pub fn watchlist_list(
    state: tauri::State<AppState>,
    category_id: Option<i64>,
    status: Option<String>,
) -> Result<Vec<WatchlistEntry>, String> {
    if let Some(s) = status.as_deref() {
        validate_status(s)?;
    }
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    let rows = repo::watchlist_list(&conn, profile_id, category_id, status.as_deref())
        .map_err(|e| e.to_string())?;
    let ids: Vec<i64> = rows.iter().map(|r| r.title_id).collect();
    // Affiche personnalisée prioritaire, en une requête pour toute la liste.
    let custom = custom_image_repository::get_batch_posters(&conn, &ids).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| WatchlistEntry {
            title: TitleSummary {
                id: r.title_id,
                category_id: r.category_id,
                kind: r.kind,
                name: r.name,
                year: r.year,
                poster: custom.get(&r.title_id).cloned().or(r.poster_path),
            },
            status: r.status,
            added_at: r.added_at,
            rating: r.rating,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::validate_status;

    #[test]
    fn status_validation() {
        for ok in ["todo", "in_progress", "done"] {
            assert!(validate_status(ok).is_ok());
        }
        assert!(validate_status("watching").is_err());
        assert!(validate_status("").is_err());
    }
}
