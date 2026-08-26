//! Commandes d'authentification des profils (Étape 6c, doc §6.5).

use crate::db::repositories::profile_repository::{self, ProfileRecord};
use crate::domain::profile;
use crate::security::profile_auth;
use crate::state::AppState;
use serde::Serialize;

#[derive(Serialize)]
pub struct LoginState {
    pub profiles: Vec<ProfileRecord>,
    pub is_first_run: bool,
}

#[tauri::command]
pub fn get_login_state(state: tauri::State<AppState>) -> Result<LoginState, String> {
    let profiles = profile::list_profiles(&state.db_pool)?;
    Ok(LoginState {
        is_first_run: profiles.is_empty(),
        profiles,
    })
}

#[tauri::command]
pub fn login_profile(
    state: tauri::State<AppState>,
    profile_id: i64,
    password: Option<String>,
    recovery_code: Option<String>,
) -> Result<ProfileRecord, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let profile = profile_repository::get_by_id(&conn, profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())?;

    if let Some(ref hash) = profile.password_hash {
        match (password, recovery_code) {
            (Some(pwd), None) => {
                if !profile_auth::verify_password(&pwd, hash)? {
                    return Err("Mot de passe incorrect.".to_string());
                }
            }
            (None, Some(code)) => {
                if let Some(ref recovery_hash) = profile.recovery_code_hash {
                    if !profile_auth::verify_recovery_code(&code, recovery_hash)? {
                        return Err("Code de récupération incorrect.".to_string());
                    }
                } else {
                    return Err("Aucun code de récupération n'a été généré pour ce profil.".to_string());
                }
            }
            (Some(_), Some(_)) => {
                return Err("Fournir soit un mot de passe, soit un code de récupération, pas les deux.".to_string());
            }
            (None, None) => {
                return Err("Ce profil requiert un mot de passe.".to_string());
            }
        }
    }

    let mut guard = state
        .active_profile_id
        .lock()
        .map_err(|_| "État du profil actif inaccessible.".to_string())?;
    *guard = Some(profile.id);

    Ok(profile)
}

#[tauri::command]
pub fn logout_profile(state: tauri::State<AppState>) -> Result<(), String> {
    let mut guard = state
        .active_profile_id
        .lock()
        .map_err(|_| "État du profil actif inaccessible.".to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn setup_first_admin(
    state: tauri::State<AppState>,
    name: String,
    password: Option<String>,
) -> Result<(ProfileRecord, Option<String>), String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let existing = profile_repository::list_all(&conn).map_err(|e| e.to_string())?;
    if !existing.is_empty() {
        return Err("Un profil existe déjà.".to_string());
    }

    let profile_id = profile_repository::create(
        &conn,
        &name,
        "Administrateur",
        true,
        true,
        true,
    )
    .map_err(|e| e.to_string())?;

    let recovery_code = if let Some(ref pwd) = password {
        let hash = profile_auth::hash_password(pwd)?;
        let (code, code_hash) = profile_auth::generate_recovery_code()?;
        profile_repository::update_auth(&conn, profile_id, Some(&hash), Some(&code_hash))
            .map_err(|e| e.to_string())?;
        Some(code)
    } else {
        None
    };

    let profile = profile_repository::get_by_id(&conn, profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil créé introuvable.".to_string())?;

    let mut guard = state
        .active_profile_id
        .lock()
        .map_err(|_| "État du profil actif inaccessible.".to_string())?;
    *guard = Some(profile.id);

    Ok((profile, recovery_code))
}

#[tauri::command]
pub fn change_own_password(
    state: tauri::State<AppState>,
    old_password: Option<String>,
    new_password: Option<String>,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let profile = profile_repository::get_by_id(&conn, active_profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil actif introuvable.".to_string())?;

    if let Some(ref hash) = profile.password_hash {
        let old_pwd = old_password.ok_or_else(|| "Ancien mot de passe requis.".to_string())?;
        if !profile_auth::verify_password(&old_pwd, hash)? {
            return Err("Ancien mot de passe incorrect.".to_string());
        }
    }

    let new_hash = if let Some(ref new_pwd) = new_password {
        Some(profile_auth::hash_password(new_pwd)?)
    } else {
        None
    };

    profile_repository::update_auth(&conn, active_profile_id, new_hash.as_deref(), None)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn admin_reset_password(
    state: tauri::State<AppState>,
    target_profile_id: i64,
    new_password: Option<String>,
) -> Result<Option<String>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;

    let active = profile_repository::get_by_id(&conn, active_profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil actif introuvable.".to_string())?;
    if !active.can_manage_profiles {
        return Err("Permission refusée.".to_string());
    }

    let recovery_code = if let Some(ref pwd) = new_password {
        let hash = profile_auth::hash_password(pwd)?;
        let (code, code_hash) = profile_auth::generate_recovery_code()?;
        profile_repository::update_auth(&conn, target_profile_id, Some(&hash), Some(&code_hash))
            .map_err(|e| e.to_string())?;
        Some(code)
    } else {
        profile_repository::update_auth(&conn, target_profile_id, None, None)
            .map_err(|e| e.to_string())?;
        None
    };

    Ok(recovery_code)
}

#[tauri::command]
pub fn recover_with_code(
    state: tauri::State<AppState>,
    profile_id: i64,
    recovery_code: String,
    new_password: Option<String>,
) -> Result<Option<String>, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let profile = profile_repository::get_by_id(&conn, profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())?;

    let recovery_hash = profile
        .recovery_code_hash
        .ok_or_else(|| "Aucun code de récupération n'a été généré pour ce profil.".to_string())?;

    if !profile_auth::verify_recovery_code(&recovery_code, &recovery_hash)? {
        return Err("Code de récupération incorrect.".to_string());
    }

    let new_recovery_code = if let Some(ref pwd) = new_password {
        let hash = profile_auth::hash_password(pwd)?;
        let (code, code_hash) = profile_auth::generate_recovery_code()?;
        profile_repository::update_auth(&conn, profile_id, Some(&hash), Some(&code_hash))
            .map_err(|e| e.to_string())?;
        Some(code)
    } else {
        profile_repository::update_auth(&conn, profile_id, None, None)
            .map_err(|e| e.to_string())?;
        None
    };

    let mut guard = state
        .active_profile_id
        .lock()
        .map_err(|_| "État du profil actif inaccessible.".to_string())?;
    *guard = Some(profile.id);

    Ok(new_recovery_code)
}