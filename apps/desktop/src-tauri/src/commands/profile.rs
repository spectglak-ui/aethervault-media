//! Commandes du Profile Manager (Étape 6a, doc §6.5).
//!
//! `switch_active_profile` est la seule commande ici à écrire dans
//! `AppState::active_profile_id` — toutes les autres se contentent de le
//! lire, jamais de l'accepter en paramètre depuis le frontend (voir la note
//! de tête de `domain::profile`).

use crate::db::repositories::profile_repository::ProfileRecord;
use crate::domain::profile;
use crate::security::permissions::ProfilePermissions;
use crate::state::AppState;
use crate::db::repositories::profile_repository;

#[tauri::command]
pub fn list_profiles(state: tauri::State<AppState>) -> Result<Vec<ProfileRecord>, String> {
    profile::list_profiles(&state.db_pool)
}

#[tauri::command]
pub fn get_active_profile(state: tauri::State<AppState>) -> Result<ProfileRecord, String> {
    let active_profile_id = state.read_active_profile_id()?;
    profile::get_profile(&state.db_pool, active_profile_id)
}

/// Bascule le profil actif. Depuis l'Étape 6c, requiert l'authentification
/// du profil cible (mot de passe ou code de récupération) si celui-ci
/// a un mot de passe défini — sinon la bascule reste libre (accès direct).
#[tauri::command]
pub fn switch_active_profile(
    state: tauri::State<AppState>,
    profile_id: i64,
    password: Option<String>,
) -> Result<ProfileRecord, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let target = profile_repository::get_by_id(&conn, profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())?;

    // Vérifie le mot de passe si le profil cible en a un
    if let Some(hash) = &target.password_hash {
        let pwd = password.ok_or_else(|| "Ce profil requiert un mot de passe.".to_string())?;
        if !crate::security::profile_auth::verify_password(&pwd, hash)? {
            return Err("Mot de passe incorrect.".to_string());
        }
    }

    // Authentification réussie : bascule
    let mut guard = state
        .active_profile_id
        .lock()
        .map_err(|_| "État du profil actif inaccessible.".to_string())?;
    *guard = Some(target.id);

    Ok(target)
}

#[tauri::command]
pub fn create_profile(
    state: tauri::State<AppState>,
    name: String,
    profile_type: String,
    permissions: Option<ProfilePermissions>,
) -> Result<ProfileRecord, String> {
    let active_profile_id = state.read_active_profile_id()?;
    profile::create_profile(&state.db_pool, active_profile_id, &name, &profile_type, permissions)
}

#[tauri::command]
pub fn rename_profile(
    state: tauri::State<AppState>,
    profile_id: i64,
    name: String,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    profile::rename_profile(&state.db_pool, active_profile_id, profile_id, &name)
}

#[tauri::command]
pub fn update_profile_permissions(
    state: tauri::State<AppState>,
    profile_id: i64,
    permissions: ProfilePermissions,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    profile::update_profile_permissions(&state.db_pool, active_profile_id, profile_id, permissions)
}

#[tauri::command]
pub fn delete_profile(state: tauri::State<AppState>, profile_id: i64) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    profile::delete_profile(&state.db_pool, active_profile_id, profile_id)
}
