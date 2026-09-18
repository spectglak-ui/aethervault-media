//! Privacy/Security Manager (Étape 6a, doc §6.4/§6.4 bis).
//!
//! Double condition d'accès à tout ce qui touche au coffre privé,
//! vérifiée indépendamment et cumulativement à chaque appel :
//! 1. le coffre est déverrouillé (`security::vault::VaultState`) ;
//! 2. le profil actif dispose de `can_access_private`.
//! Déverrouiller le coffre sous un profil autorisé ne le rend pas
//! accessible à un profil non autorisé actif ensuite dans la même
//! session — voir doc §6.4, "Portée".
//!
//! La création/le changement du secret du coffre (qui affecte
//! l'installation entière, pas un profil en particulier) est en revanche
//! réservée à `can_manage_global_settings` — décision documentée en
//! §6.4 bis.
//!
//! Chaque fonction qui modifie le contenu du coffre appelle
//! `vault_state.persist_if_unlocked()` juste après — le coffre (architecture
//! A2, base SQLite en mémoire) est ré-écrit chiffré sur disque après chaque
//! écriture, jamais seulement à la fermeture (voir `security::vault`).

use crate::db::repositories::private_repository::{self, PrivateLibraryRecord};
use crate::db::repositories::profile_repository;
use crate::db::DbPool;
use crate::security::vault::{self, VaultHandle, VaultState};
use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
}

pub fn vault_status(pool: &DbPool, vault_state: &VaultState) -> Result<VaultStatus, String> {
    Ok(VaultStatus {
        initialized: vault::is_initialized(pool)?,
        unlocked: vault_state.is_unlocked(),
    })
}

/// `pub(crate)` : réutilisée telle quelle par `domain::private_video`
/// (Étape 6b-i) plutôt que dupliquée — un seul et même critère de
/// "profil autorisé à toucher au coffre", quel que soit le sous-domaine
/// (bibliothèques conteneurs ici, dossiers/fichiers vidéo là-bas).
pub(crate) fn require_private_access(pool: &DbPool, active_profile_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let profile = profile_repository::get_by_id(&conn, active_profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil actif introuvable.".to_string())?;
    if !profile.can_access_private {
        // Message volontairement générique : un profil non autorisé ne
        // doit rien apprendre de plus, y compris sur l'existence ou l'état
        // du coffre (doc §6.4, "Aucune information avant authentification").
        return Err("Accès non autorisé.".to_string());
    }
    Ok(())
}

fn require_manage_global_settings(pool: &DbPool, active_profile_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let profile = profile_repository::get_by_id(&conn, active_profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Profil actif introuvable.".to_string())?;
    if !profile.can_manage_global_settings {
        return Err(
            "Cette action est réservée à un profil disposant de la permission de gestion des paramètres globaux."
                .to_string(),
        );
    }
    Ok(())
}

/// `pub(crate)`, même raison que `require_private_access` ci-dessus.
pub(crate) fn require_unlocked_connection(vault_state: &VaultState) -> Result<&Connection, String> {
    vault_state
        .connection()
        .ok_or_else(|| "Le coffre privé est verrouillé.".to_string())
}

/// Règles de robustesse minimales du PIN/mot de passe. Volontairement
/// simples pour l'Étape 6a — l'essentiel de la résistance vient d'Argon2id
/// (§6.4 bis), pas d'une politique de complexité élaborée.
fn validate_secret(secret_kind: &str, secret: &str) -> Result<(), String> {
    match secret_kind {
        "pin" => {
            if secret.len() < 4 || !secret.chars().all(|c| c.is_ascii_digit()) {
                return Err("Le PIN doit contenir au moins 4 chiffres.".to_string());
            }
        }
        "password" => {
            if secret.chars().count() < 8 {
                return Err("Le mot de passe doit contenir au moins 8 caractères.".to_string());
            }
        }
        _ => return Err("Type de secret invalide (attendu : pin ou password).".to_string()),
    }
    Ok(())
}

/// Premier réglage du PIN/mot de passe. Réservé à `can_manage_global_settings`
/// (décision §6.4 bis) : cette action affecte l'installation entière, pas
/// seulement le profil qui l'effectue.
pub fn setup_vault(
    pool: &DbPool,
    active_profile_id: i64,
    data_dir: &Path,
    secret_kind: &str,
    secret: &str,
) -> Result<VaultHandle, String> {
    require_manage_global_settings(pool, active_profile_id)?;
    validate_secret(secret_kind, secret)?;
    vault::initialize(pool, data_dir, secret_kind, secret)
}

/// Déverrouillage du coffre. Réservé à `can_access_private` — un profil
/// disposant seulement de `can_manage_global_settings` (mais pas de
/// `can_access_private`) peut créer/changer le secret sans pouvoir
/// consulter le contenu.
pub fn unlock_vault(
    pool: &DbPool,
    active_profile_id: i64,
    data_dir: &Path,
    secret: &str,
) -> Result<VaultHandle, String> {
    require_private_access(pool, active_profile_id)?;
    vault::unlock(pool, data_dir, secret)
}

/// Changement du secret du coffre (voir `security::vault::change_secret`).
/// Réservé à `can_manage_global_settings`, comme `setup_vault`. Mute
/// `handle` en place — architecture A2 : une seule connexion en mémoire,
/// jamais un pool, donc aucun besoin de reconstruire/remplacer quoi que ce
/// soit après un changement de clé (contrairement à l'ancienne
/// architecture SQLCipher envisagée).
pub fn change_vault_secret(
    pool: &DbPool,
    active_profile_id: i64,
    handle: &mut VaultHandle,
    secret_kind: &str,
    new_secret: &str,
) -> Result<(), String> {
    require_manage_global_settings(pool, active_profile_id)?;
    validate_secret(secret_kind, new_secret)?;
    vault::change_secret(pool, handle, secret_kind, new_secret)
}

pub fn list_private_libraries(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
) -> Result<Vec<PrivateLibraryRecord>, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;
    private_repository::list_all(conn).map_err(|e| e.to_string())
}

/// `kind` : "images" ou "videos" (doc §6.4, "Contenu, une fois déverrouillé").
/// Aucune gestion de dossier ici : une bibliothèque privée de l'Étape 6a
/// est un simple conteneur (voir Étape 6b).
pub fn create_private_library(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    kind: &str,
    name: &str,
) -> Result<PrivateLibraryRecord, String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;

    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Le nom de la bibliothèque ne peut pas être vide.".to_string());
    }
    if kind != "images" && kind != "videos" {
        return Err("Type de bibliothèque privée invalide (attendu : images ou videos).".to_string());
    }

    let id = private_repository::create(conn, kind, trimmed, None).map_err(|e| e.to_string())?;
    let created = private_repository::list_all(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|library| library.id == id)
        .ok_or_else(|| "Erreur interne : bibliothèque introuvable juste après création.".to_string())?;

    vault_state.persist_if_unlocked()?;

    Ok(created)
}

pub fn rename_private_library(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    id: i64,
    new_name: &str,
) -> Result<(), String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;

    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Le nom de la bibliothèque ne peut pas être vide.".to_string());
    }

    private_repository::rename(conn, id, trimmed).map_err(|e| e.to_string())?;
    vault_state.persist_if_unlocked()
}

pub fn delete_private_library(
    pool: &DbPool,
    active_profile_id: i64,
    vault_state: &VaultState,
    id: i64,
) -> Result<(), String> {
    require_private_access(pool, active_profile_id)?;
    let conn = require_unlocked_connection(vault_state)?;

    private_repository::delete(conn, id).map_err(|e| e.to_string())?;
    vault_state.persist_if_unlocked()
}
