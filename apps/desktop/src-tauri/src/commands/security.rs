//! Commandes du Privacy/Security Manager (Étape 6a, doc §6.4/§6.4 bis).
//!
//! Seules commandes autorisées à lire/écrire `AppState::vault`. Toute
//! commande qui a besoin du contenu du coffre (bibliothèques privées) passe
//! par ici, jamais directement par `domain::privacy` depuis un autre
//! fichier de `commands/`.

use crate::db::repositories::private_repository::PrivateLibraryRecord;
use crate::domain::privacy::{self, VaultStatus};
use crate::security::vault::VaultState;
use crate::state::AppState;
use std::path::PathBuf;

#[tauri::command]
pub fn get_vault_status(state: tauri::State<AppState>) -> Result<VaultStatus, String> {
    let vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    privacy::vault_status(&state.db_pool, &vault_guard)
}

/// Premier réglage du PIN/mot de passe — réservé à un profil disposant de
/// `can_manage_global_settings` (doc §6.4 bis). `secret_kind` : `"pin"` ou
/// `"password"`.
#[tauri::command]
pub fn setup_vault(
    state: tauri::State<AppState>,
    secret_kind: String,
    secret: String,
) -> Result<VaultStatus, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let data_dir = PathBuf::from(&state.data_dir);

    let handle = privacy::setup_vault(&state.db_pool, active_profile_id, &data_dir, &secret_kind, &secret)?;

    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    *vault_guard = VaultState::Unlocked(handle);

    Ok(VaultStatus {
        initialized: true,
        unlocked: true,
    })
}

#[tauri::command]
pub fn unlock_vault(state: tauri::State<AppState>, secret: String) -> Result<VaultStatus, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let data_dir = PathBuf::from(&state.data_dir);

    let handle = privacy::unlock_vault(&state.db_pool, active_profile_id, &data_dir, &secret)?;

    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    *vault_guard = VaultState::Unlocked(handle);

    Ok(VaultStatus {
        initialized: true,
        unlocked: true,
    })
}

/// Toujours autorisé, quel que soit le profil actif — verrouiller ne fait
/// que réduire l'exposition, jamais l'inverse.
///
/// Persiste avant de verrouiller (Étape 6b-i) : la progression de lecture
/// des vidéos privées n'est volontairement pas ré-écrite sur disque à
/// chaque mise à jour de position (toutes les 5 secondes pendant la
/// lecture — voir `domain::private_video`), seulement à la fin d'un
/// visionnage ou ici, au verrouillage — pour ne jamais perdre une
/// progression encore uniquement en mémoire à ce moment précis.
#[tauri::command]
pub fn lock_vault(state: tauri::State<AppState>) -> Result<VaultStatus, String> {
    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;

    vault_guard.persist_if_unlocked()?;
    *vault_guard = VaultState::Locked;

    Ok(VaultStatus {
        initialized: crate::security::vault::is_initialized(&state.db_pool)?,
        unlocked: false,
    })
}

#[tauri::command]
pub fn change_vault_secret(
    state: tauri::State<AppState>,
    secret_kind: String,
    new_secret: String,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;

    match &mut *vault_guard {
        VaultState::Unlocked(handle) => {
            privacy::change_vault_secret(&state.db_pool, active_profile_id, handle, &secret_kind, &new_secret)
        }
        VaultState::Locked => Err("Le coffre doit être déverrouillé pour changer le secret.".to_string()),
    }
}

#[tauri::command]
pub fn list_private_libraries(state: tauri::State<AppState>) -> Result<Vec<PrivateLibraryRecord>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    privacy::list_private_libraries(&state.db_pool, active_profile_id, &vault_guard)
}

#[tauri::command]
pub fn create_private_library(
    state: tauri::State<AppState>,
    kind: String,
    name: String,
) -> Result<PrivateLibraryRecord, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    privacy::create_private_library(&state.db_pool, active_profile_id, &vault_guard, &kind, &name)
}

#[tauri::command]
pub fn rename_private_library(
    state: tauri::State<AppState>,
    library_id: i64,
    name: String,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    let vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    privacy::rename_private_library(&state.db_pool, active_profile_id, &vault_guard, library_id, &name)
}

#[tauri::command]
pub fn delete_private_library(state: tauri::State<AppState>, library_id: i64) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    let vault_guard = state
        .vault
        .lock()
        .map_err(|_| "État du coffre inaccessible.".to_string())?;
    privacy::delete_private_library(&state.db_pool, active_profile_id, &vault_guard, library_id)
}
