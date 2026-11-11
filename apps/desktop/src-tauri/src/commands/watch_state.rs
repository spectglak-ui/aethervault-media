//! Statuts de visionnage « À voir / En cours / Vu » (0.7.9) — PAR PROFIL.
//!
//! La pose AUTOMATIQUE des statuts n'est pas ici : elle se fait à chaque
//! sauvegarde de progression (`commands::playback::save_playback_progress` →
//! `domain::playback::save_progress` → `domain::watch_state::record_progress`).
//! Ces commandes servent à LIRE les statuts (grilles, listes d'épisodes, pages de
//! titre) et au marquage MANUEL. Toutes agissent sur le profil actif.

use serde::Serialize;

use crate::db::repositories::watch_state_repository::{self as repo, MediaWatchRow};
use crate::domain::watch_state::{self, ResumeTarget, TitleWatchState};
use crate::state::AppState;

/// Statut de plusieurs titres en une requête (grilles d'affiches). Tous les
/// ids demandés sont renvoyés ; « À voir » par défaut.
#[tauri::command]
pub fn list_title_watch_states(
    state: tauri::State<AppState>,
    title_ids: Vec<i64>,
) -> Result<Vec<TitleWatchState>, String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    watch_state::title_states(&conn, profile_id, &title_ids)
}

/// Statut + avancement de plusieurs fichiers (listes d'épisodes, page d'un film).
#[tauri::command]
pub fn list_media_watch_states(
    state: tauri::State<AppState>,
    media_file_ids: Vec<i64>,
) -> Result<Vec<MediaWatchRow>, String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    repo::media_states(&conn, profile_id, &media_file_ids).map_err(|e| e.to_string())
}

/// Marquage manuel d'un fichier : `done` (« Vu ») ou `todo` (« À voir », efface
/// aussi la position de reprise).
#[tauri::command]
pub fn set_media_watch_status(
    state: tauri::State<AppState>,
    media_file_id: i64,
    status: String,
) -> Result<(), String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    watch_state::set_media_status(&conn, profile_id, media_file_id, &status)
}

/// Marquage manuel d'un titre entier (film, ou tous les épisodes d'une série).
#[tauri::command]
pub fn set_title_watch_status(
    state: tauri::State<AppState>,
    title_id: i64,
    status: String,
) -> Result<(), String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    watch_state::set_title_status(&conn, profile_id, title_id, &status)
}

/// Épisode à proposer pour « Continuer » une série (`null` si tout est vu ou si
/// la série n'a aucun épisode disponible).
#[tauri::command]
pub fn get_title_resume_target(
    state: tauri::State<AppState>,
    title_id: i64,
) -> Result<Option<ResumeTarget>, String> {
    let profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    watch_state::resume_target(&conn, profile_id, title_id)
}

/// Réglages de dosage exposés en lecture seule (diagnostic / page Paramètres).
#[derive(Debug, Clone, Serialize)]
pub struct WatchThresholds {
    pub credits_tolerance_seconds: f64,
    pub tail_ratio: f64,
    pub tail_min_seconds: f64,
    pub tail_max_seconds: f64,
    pub in_progress_min_seconds: f64,
}

#[tauri::command]
pub fn get_watch_thresholds() -> WatchThresholds {
    WatchThresholds {
        credits_tolerance_seconds: watch_state::CREDITS_TOLERANCE_SECONDS,
        tail_ratio: watch_state::TAIL_RATIO,
        tail_min_seconds: watch_state::TAIL_MIN_SECONDS,
        tail_max_seconds: watch_state::TAIL_MAX_SECONDS,
        in_progress_min_seconds: watch_state::IN_PROGRESS_MIN_SECONDS,
    }
}
