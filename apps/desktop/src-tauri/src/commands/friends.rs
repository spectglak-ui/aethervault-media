//! Commandes du système d'amis (0.4.0).

use crate::state::AppState;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct FriendDto {
    pub profile_id: i64,
    pub name: String,
    pub avatar_path: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct ActivityDto {
    pub profile_id: i64,
    pub profile_name: String,
    pub profile_avatar: Option<String>,
    pub title_id: Option<i64>,
    pub title_name: Option<String>,
    pub poster: Option<String>,
    pub category_key: Option<String>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub updated_at: Option<String>,
}

#[derive(Deserialize)]
pub struct ActivityUpdate {
    pub title_id: Option<i64>,
    pub title_name: Option<String>,
    pub poster: Option<String>,
    pub category_key: Option<String>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
}

/// Ajoute un profil à la liste d'amis du profil actif.
#[tauri::command]
pub fn add_friend(
    state: tauri::State<AppState>,
    friend_profile_id: i64,
) -> Result<(), String> {
    let profile_id = state
        .active_profile_id
        .lock()
        .unwrap()
        .ok_or_else(|| "Aucun profil actif".to_string())?;
    if profile_id == friend_profile_id {
        return Err("Impossible de s'ajouter soi-même comme ami".to_string());
    }
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO friends (profile_id, friend_profile_id) VALUES (?1, ?2)",
        rusqlite::params![profile_id, friend_profile_id],
    )
    .map_err(|e| format!("Erreur d'ajout d'ami : {e}"))?;
    Ok(())
}

/// Supprime un ami de la liste du profil actif.
#[tauri::command]
pub fn remove_friend(state: tauri::State<AppState>, friend_profile_id: i64) -> Result<(), String> {
    let profile_id = state
        .active_profile_id
        .lock()
        .unwrap()
        .ok_or_else(|| "Aucun profil actif".to_string())?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM friends WHERE profile_id = ?1 AND friend_profile_id = ?2",
        rusqlite::params![profile_id, friend_profile_id],
    )
    .map_err(|e| format!("Erreur de suppression d'ami : {e}"))?;
    Ok(())
}

/// Liste tous les amis du profil actif.
#[tauri::command]
pub fn list_friends(state: tauri::State<AppState>) -> Result<Vec<FriendDto>, String> {
    let profile_id = state
        .active_profile_id
        .lock()
        .unwrap()
        .ok_or_else(|| "Aucun profil actif".to_string())?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT f.friend_profile_id, p.name, a.path, f.created_at
             FROM friends f
             JOIN profiles p ON p.id = f.friend_profile_id
             LEFT JOIN custom_images a ON a.id = (
                 SELECT id FROM custom_images WHERE kind = 'profile_avatar' AND owner_id = p.id
             )
             WHERE f.profile_id = ?1
             ORDER BY p.name",
        )
        .map_err(|e| e.to_string())?;
    let friends = stmt
        .query_map(rusqlite::params![profile_id], |row| {
            Ok(FriendDto {
                profile_id: row.get(0)?,
                name: row.get(1)?,
                avatar_path: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(friends)
}

/// Récupère l'activité de visionnage des amis (ceux qui partagent leur activité).
#[tauri::command]
pub fn get_friends_activity(state: tauri::State<AppState>) -> Result<Vec<ActivityDto>, String> {
    let profile_id = state
        .active_profile_id
        .lock()
        .unwrap()
        .ok_or_else(|| "Aucun profil actif".to_string())?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT a.profile_id, p.name, av.path, a.title_id, a.title_name, a.poster,
                    a.category_key, a.position_seconds, a.duration_seconds, a.updated_at
             FROM friends f
             JOIN profile_activity a ON a.profile_id = f.friend_profile_id
             JOIN profiles p ON p.id = a.profile_id
             LEFT JOIN custom_images av ON av.id = (
                 SELECT id FROM custom_images WHERE kind = 'profile_avatar' AND owner_id = p.id
             )
             LEFT JOIN profile_settings s ON s.profile_id = a.profile_id
             WHERE f.profile_id = ?1 AND (s.activity_visibility IS NULL OR s.activity_visibility = 1)
             ORDER BY a.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let activities = stmt
        .query_map(rusqlite::params![profile_id], |row| {
            Ok(ActivityDto {
                profile_id: row.get(0)?,
                profile_name: row.get(1)?,
                profile_avatar: row.get(2)?,
                title_id: row.get(3)?,
                title_name: row.get(4)?,
                poster: row.get(5)?,
                category_key: row.get(6)?,
                position_seconds: row.get(7)?,
                duration_seconds: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(activities)
}

/// Met à jour l'activité de visionnage du profil actif.
#[tauri::command]
pub fn update_activity(
    state: tauri::State<AppState>,
    update: ActivityUpdate,
) -> Result<(), String> {
    let profile_id = state
        .active_profile_id
        .lock()
        .unwrap()
        .ok_or_else(|| "Aucun profil actif".to_string())?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO profile_activity
         (profile_id, title_id, title_name, poster, category_key, position_seconds, duration_seconds, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
        rusqlite::params![
            profile_id,
            update.title_id,
            update.title_name,
            update.poster,
            update.category_key,
            update.position_seconds,
            update.duration_seconds,
        ],
    )
    .map_err(|e| format!("Erreur de mise à jour de l'activité : {e}"))?;
    Ok(())
}

/// Efface l'activité de visionnage du profil actif (arrête de regarder).
#[tauri::command]
pub fn clear_activity(state: tauri::State<AppState>) -> Result<(), String> {
    let profile_id = state
        .active_profile_id
        .lock()
        .unwrap()
        .ok_or_else(|| "Aucun profil actif".to_string())?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM profile_activity WHERE profile_id = ?1",
        rusqlite::params![profile_id],
    )
    .map_err(|e| format!("Erreur d'effacement de l'activité : {e}"))?;
    Ok(())
}

/// Définit la visibilité de l'activité du profil actif (true = visible aux amis).
#[tauri::command]
pub fn set_activity_visibility(
    state: tauri::State<AppState>,
    visible: bool,
) -> Result<(), String> {
    let profile_id = state
        .active_profile_id
        .lock()
        .unwrap()
        .ok_or_else(|| "Aucun profil actif".to_string())?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO profile_settings (profile_id, activity_visibility)
         VALUES (?1, ?2)",
        rusqlite::params![profile_id, if visible { 1 } else { 0 }],
    )
    .map_err(|e| format!("Erreur de mise à jour de la visibilité : {e}"))?;
    Ok(())
}

/// Récupère la visibilité actuelle de l'activité du profil actif.
#[tauri::command]
pub fn get_activity_visibility(state: tauri::State<AppState>) -> Result<bool, String> {
    let profile_id = state
        .active_profile_id
        .lock()
        .unwrap()
        .ok_or_else(|| "Aucun profil actif".to_string())?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let visible: i32 = conn
        .query_row(
            "SELECT COALESCE(activity_visibility, 1) FROM profile_settings WHERE profile_id = ?1",
            rusqlite::params![profile_id],
            |row| row.get(0),
        )
        .unwrap_or(1);
    Ok(visible == 1)
}