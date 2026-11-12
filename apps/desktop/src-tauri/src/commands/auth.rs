//! Commandes d'authentification des profils (Étape 6c, doc §6.5).

use crate::db::repositories::profile_repository::{self, ProfileRecord};
use crate::domain::{profile, profile_secret};
use crate::security::{login_throttle, profile_auth};
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

/// Échec de vérification : « secret incorrect » (compté par le ralentisseur) ou
/// autre erreur (requête incomplète, hash illisible…), qui ne l'est pas.
enum LoginError {
    Wrong(String),
    Other(String),
}

/// Nom du secret du profil, pour les messages (« mot de passe » ou « code PIN »).
pub(crate) fn secret_label(profile: &ProfileRecord) -> &'static str {
    if profile.auth_kind.as_deref() == Some("pin") {
        "code PIN"
    } else {
        "mot de passe"
    }
}

fn verify_login(
    profile: &ProfileRecord,
    hash: &str,
    password: Option<String>,
    recovery_code: Option<String>,
) -> Result<(), LoginError> {
    let label = secret_label(profile);
    match (password, recovery_code) {
        (Some(pwd), None) => {
            if profile_auth::verify_password(&pwd, hash).map_err(LoginError::Other)? {
                Ok(())
            } else if label == "code PIN" {
                Err(LoginError::Wrong("Code PIN incorrect.".to_string()))
            } else {
                Err(LoginError::Wrong("Mot de passe incorrect.".to_string()))
            }
        }
        (None, Some(code)) => match profile.recovery_code_hash {
            Some(ref recovery_hash) => {
                if profile_auth::verify_recovery_code(&code, recovery_hash).map_err(LoginError::Other)? {
                    Ok(())
                } else {
                    Err(LoginError::Wrong("Code de récupération incorrect.".to_string()))
                }
            }
            None => Err(LoginError::Other(
                "Aucun code de récupération n'a été généré pour ce profil.".to_string(),
            )),
        },
        (Some(_), Some(_)) => Err(LoginError::Other(
            "Fournir soit un mot de passe, soit un code de récupération, pas les deux.".to_string(),
        )),
        (None, None) => Err(LoginError::Other(format!("Ce profil requiert un {label}."))),
    }
}

#[tauri::command]
pub fn login_profile(
    state: tauri::State<AppState>,
    profile_id: i64,
    password: Option<String>,
    recovery_code: Option<String>,
) -> Result<ProfileRecord, String> {
    let conn = state.get_conn()?;
    let profile = profile_repository::get_by_id(&conn, profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())?;

    if let Some(ref hash) = profile.password_hash {
        // 0.7.9 : essais répétés ralentis (indispensable pour un PIN de 4 chiffres).
        login_throttle::check(profile.id)?;
        match verify_login(&profile, hash, password, recovery_code) {
            Ok(()) => login_throttle::record_success(profile.id),
            Err(LoginError::Wrong(message)) => {
                login_throttle::record_failure(profile.id);
                return Err(message);
            }
            Err(LoginError::Other(message)) => return Err(message),
        }
    }

    let mut guard = state
        .active_profile_id
        .lock()
        .map_err(|_| "État du profil actif inaccessible.".to_string())?;
    *guard = Some(profile.id);

    Ok(profile)
}

/// FONCTIONNALITÉ (Accès rapide) : connexion en un clic, en contournant
/// la vérification du mot de passe. Le réglage est revérifié CÔTÉ
/// SERVEUR (jamais fait confiance à l'UI) avant de contourner quoi que
/// ce soit — voir `commands::settings::get_quick_access_enabled` pour
/// où/comment ce réglage est activé. Le Coffre privé n'est jamais
/// concerné : il exige sa propre phrase secrète (dérivation de clé
/// AES, `security::vault`), entièrement indépendante de la connexion
/// de profil.
#[tauri::command]
pub fn quick_login_profile(
    state: tauri::State<AppState>,
    profile_id: i64,
) -> Result<ProfileRecord, String> {
    let conn = state.get_conn()?;
    let enabled = crate::db::repositories::settings_repository::get(&conn, "quick_access_enabled")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("1");
    if !enabled {
        return Err("Accès rapide désactivé.".to_string());
    }
    let profile = profile_repository::get_by_id(&conn, profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())?;

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

/// Crée le premier administrateur. `password` est le secret (mot de passe ou PIN
/// selon `kind` : `"password"` par défaut, `"pin"`). Le secret est VALIDÉ avant toute
/// écriture : un secret refusé ne laisse pas d'administrateur sans protection.
#[tauri::command]
pub fn setup_first_admin(
    state: tauri::State<AppState>,
    name: String,
    password: Option<String>,
    kind: Option<String>,
) -> Result<(ProfileRecord, Option<String>), String> {
    let conn = state.get_conn()?;
    let existing = profile_repository::list_all(&conn).map_err(|e| e.to_string())?;
    if !existing.is_empty() {
        return Err("Un profil existe déjà.".to_string());
    }
    if name.trim().is_empty() {
        return Err("Le nom du compte ne peut pas être vide.".to_string());
    }

    let prepared = password
        .as_deref()
        .map(|secret| profile_secret::prepare_secret(secret, kind.as_deref()))
        .transpose()?;

    let profile_id = profile_repository::create(
        &conn,
        name.trim(),
        "Administrateur",
        true,
        true,
        true,
    )
    .map_err(|e| e.to_string())?;

    let recovery_code = match prepared {
        Some(ref secret) => {
            profile_secret::apply_secret(&conn, profile_id, secret)?;
            Some(secret.recovery_code.clone())
        }
        None => None,
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

/// Change (ou retire, si `new_password` est vide) le secret du profil ACTIF.
/// Exige le secret actuel s'il y en a un. Renvoie le NOUVEAU code de récupération
/// (l'ancien n'est plus valable) quand un secret est défini.
#[tauri::command]
pub fn change_own_password(
    state: tauri::State<AppState>,
    old_password: Option<String>,
    new_password: Option<String>,
    kind: Option<String>,
) -> Result<Option<String>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    let profile = profile_repository::get_by_id(&conn, active_profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil actif introuvable.".to_string())?;

    if let Some(ref hash) = profile.password_hash {
        let label = secret_label(&profile);
        login_throttle::check(active_profile_id)?;
        let old = old_password.ok_or_else(|| format!("Le {label} actuel est requis."))?;
        if !profile_auth::verify_password(&old, hash)? {
            login_throttle::record_failure(active_profile_id);
            return Err(format!("Le {label} actuel est incorrect."));
        }
        login_throttle::record_success(active_profile_id);
    }

    profile_secret::set_secret(&conn, active_profile_id, new_password.as_deref(), kind.as_deref())
}

/// Définit (ou retire) le secret d'un profil par un administrateur. Renvoie le
/// nouveau code de récupération quand un secret est défini.
#[tauri::command]
pub fn admin_reset_password(
    state: tauri::State<AppState>,
    target_profile_id: i64,
    new_password: Option<String>,
    kind: Option<String>,
) -> Result<Option<String>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;

    let active = profile_repository::get_by_id(&conn, active_profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil actif introuvable.".to_string())?;
    if !active.can_manage_profiles {
        return Err("Permission refusée.".to_string());
    }

    profile_secret::set_secret(&conn, target_profile_id, new_password.as_deref(), kind.as_deref())
}

/// Récupération d'accès avec le code de récupération : définit un nouveau secret
/// (`new_password` vide = profil sans secret) et ouvre la session.
#[tauri::command]
pub fn recover_with_code(
    state: tauri::State<AppState>,
    profile_id: i64,
    recovery_code: String,
    new_password: Option<String>,
    kind: Option<String>,
) -> Result<Option<String>, String> {
    let conn = state.get_conn()?;
    let profile = profile_repository::get_by_id(&conn, profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())?;

    let recovery_hash = profile
        .recovery_code_hash
        .clone()
        .ok_or_else(|| "Aucun code de récupération n'a été généré pour ce profil.".to_string())?;

    login_throttle::check(profile_id)?;
    if !profile_auth::verify_recovery_code(&recovery_code, &recovery_hash)? {
        login_throttle::record_failure(profile_id);
        return Err("Code de récupération incorrect.".to_string());
    }
    login_throttle::record_success(profile_id);

    // Validé AVANT d'écrire : un nouveau secret refusé laisse l'ancien en place.
    let new_recovery_code =
        profile_secret::set_secret(&conn, profile_id, new_password.as_deref(), kind.as_deref())?;

    let mut guard = state
        .active_profile_id
        .lock()
        .map_err(|_| "État du profil actif inaccessible.".to_string())?;
    *guard = Some(profile.id);

    Ok(new_recovery_code)
}
