//! Profile Manager (Étape 6a, doc §6.5).
//!
//! CRUD complet des profils et modèle de permissions hybride
//! (`security::permissions`, décision C3). Le profil actif est un état
//! Rust (`AppState::active_profile_id`), jamais un identifiant transmis
//! librement par le frontend : chaque fonction ici qui vérifie une
//! permission reçoit l'id du profil actif en paramètre explicite, lu par
//! la commande depuis `AppState` juste avant l'appel — même principe que
//! `pool: &DbPool` plutôt que `state: &AppState` dans le reste du code.

use crate::db::repositories::profile_repository::{self, ProfileRecord};
use crate::db::DbPool;
use crate::security::permissions::{self, ProfilePermissions, ProfileType};
use rusqlite::Connection;

pub fn list_profiles(pool: &DbPool) -> Result<Vec<ProfileRecord>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    profile_repository::list_all(&conn).map_err(|e| e.to_string())
}

pub fn get_profile(pool: &DbPool, id: i64) -> Result<ProfileRecord, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    profile_repository::get_by_id(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())
}

/// Vérifie que le profil actif a la permission de gérer les autres
/// profils — utilisé avant toute création/renommage/permission/suppression.
fn require_can_manage_profiles(conn: &Connection, active_profile_id: i64) -> Result<(), String> {
    let profile = profile_repository::get_by_id(conn, active_profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil actif introuvable.".to_string())?;
    if !profile.can_manage_profiles {
        return Err(
            "Cette action est réservée à un profil disposant de la permission de gestion des profils."
                .to_string(),
        );
    }
    Ok(())
}

pub fn create_profile(
    pool: &DbPool,
    active_profile_id: i64,
    name: &str,
    profile_type: &str,
    permissions_override: Option<ProfilePermissions>,
) -> Result<ProfileRecord, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Le nom du profil ne peut pas être vide.".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    require_can_manage_profiles(&conn, active_profile_id)?;

    let resolved_type = ProfileType::from_str(profile_type);
    let perms = permissions_override.unwrap_or_else(|| permissions::defaults_for(resolved_type));

    let id = profile_repository::create(
        &conn,
        trimmed,
        resolved_type.as_str(),
        perms.can_access_private,
        perms.can_manage_global_settings,
        perms.can_manage_profiles,
    )
    .map_err(|e| e.to_string())?;

    profile_repository::get_by_id(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Erreur interne : profil introuvable juste après création.".to_string())
}

pub fn rename_profile(
    pool: &DbPool,
    active_profile_id: i64,
    target_id: i64,
    new_name: &str,
) -> Result<(), String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Le nom du profil ne peut pas être vide.".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    require_can_manage_profiles(&conn, active_profile_id)?;
    profile_repository::rename(&conn, target_id, trimmed).map_err(|e| e.to_string())
}

pub fn update_profile_permissions(
    pool: &DbPool,
    active_profile_id: i64,
    target_id: i64,
    new_permissions: ProfilePermissions,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    require_can_manage_profiles(&conn, active_profile_id)?;

    let target = profile_repository::get_by_id(&conn, target_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())?;

    // L'application doit toujours conserver au moins un profil disposant
    // de `can_manage_profiles` (doc §6.5) — sans quoi plus personne ne
    // pourrait gérer les profils, y compris pour corriger l'erreur.
    if target.can_manage_profiles && !new_permissions.can_manage_profiles {
        let count = profile_repository::count_with_manage_profiles(&conn).map_err(|e| e.to_string())?;
        if count <= 1 {
            return Err(
                "Impossible de retirer cette permission : au moins un profil doit toujours pouvoir gérer les profils."
                    .to_string(),
            );
        }
    }

    profile_repository::update_permissions(
        &conn,
        target_id,
        new_permissions.can_access_private,
        new_permissions.can_manage_global_settings,
        new_permissions.can_manage_profiles,
    )
    .map_err(|e| e.to_string())
}

pub fn delete_profile(pool: &DbPool, active_profile_id: i64, target_id: i64) -> Result<(), String> {
    if target_id == active_profile_id {
        return Err("Impossible de supprimer le profil actuellement actif.".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    require_can_manage_profiles(&conn, active_profile_id)?;

    let target = profile_repository::get_by_id(&conn, target_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil introuvable.".to_string())?;

    if target.can_manage_profiles {
        let count = profile_repository::count_with_manage_profiles(&conn).map_err(|e| e.to_string())?;
        if count <= 1 {
            return Err(
                "Impossible de supprimer le dernier profil disposant de la permission de gestion des profils."
                    .to_string(),
            );
        }
    }

    // La progression de lecture propre à ce profil disparaît avec lui via
    // `ON DELETE CASCADE` (migration 0007) — pas de nettoyage manuel ici.
    profile_repository::delete(&conn, target_id).map_err(|e| e.to_string())
}

/// Profil réactivé automatiquement à chaque lancement de l'application —
/// le premier disposant de `can_manage_profiles` (doc §6.5). Appelé une
/// seule fois, au démarrage (`lib.rs`) ; la bascule en cours de session
/// passe par `switch_active_profile` ci-dessous.
pub fn default_startup_profile_id(pool: &DbPool) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    profile_repository::first_profile_with_manage_profiles(&conn)
        .map_err(|e| e.to_string())?
        .map(|p| p.id)
        .ok_or_else(|| "Aucun profil administrateur trouvé.".to_string())
}

/// Valide qu'un profil existe avant bascule — ne demande aucune
/// authentification propre : seul le coffre privé (§6.4) est protégé par
/// PIN/mot de passe, pas les profils entre eux. C'est la commande
/// appelante (`commands::profile::switch_active_profile`) qui écrit
/// ensuite le résultat dans `AppState::active_profile_id`.
pub fn switch_active_profile(pool: &DbPool, target_id: i64) -> Result<ProfileRecord, String> {
    get_profile(pool, target_id)
}
