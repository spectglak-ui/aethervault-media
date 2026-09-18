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
    let conn = state.get_conn()?;
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

/// Image de profil (0.3.0) : l'image choisie arrive en bytes (input
/// file), est copiée dans le dossier applicatif `avatars/`, et sa
/// référence est stockée dans app_settings (clé `profile_avatar_{id}`)
/// — volontairement PAS custom_images, dont le CHECK SQL est limité aux
/// personnalisations de titres.
#[tauri::command]
pub fn set_profile_avatar(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    use tauri::Manager;
    let active_profile_id = state.read_active_profile_id()?;
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return Err("Image invalide (taille attendue : entre 1 o et 8 Mo).".to_string());
    }
    let ext = std::path::Path::new(&file_name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif"))
        .unwrap_or_else(|| "png".to_string());
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("avatars");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("profile_{active_profile_id}.{ext}"));
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    let conn = state.get_conn()?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![format!("profile_avatar_{active_profile_id}"), target.to_string_lossy()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Image de profil (0.3.0) : lit le chemin de l'avatar d'un profil —
/// volontairement sans permission (donnée non sensible, utilisée par
/// l'écran de connexion avant tout profil actif).
#[tauri::command]
pub fn get_profile_avatar(
    state: tauri::State<AppState>,
    profile_id: i64,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    let conn = state.get_conn()?;
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![format!("profile_avatar_{profile_id}")],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Image de profil (0.3.0) : retire l'avatar du profil actif (fichier
/// disque + référence).
#[tauri::command]
pub fn clear_profile_avatar(state: tauri::State<AppState>) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    // 1) Lit le chemin actuel (s'il existe) pour supprimer le fichier.
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            rusqlite::params![format!("profile_avatar_{active_profile_id}")],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(path) = existing {
        let _ = std::fs::remove_file(path);
    }
    // 2) Efface la référence en base.
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        rusqlite::params![format!("profile_avatar_{active_profile_id}")],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}