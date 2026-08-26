//! Accès SQL à la table `profiles`.
//!
//! Depuis l'Étape 6a : CRUD complet (création/renommage/permissions/
//! suppression), là où seule la lecture existait jusqu'ici. Voir
//! `domain::profile` pour les règles (dernier profil administrateur
//! protégé, etc.) — ce module reste volontairement sans logique métier,
//! uniquement du SQL.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ProfileRecord {
    pub id: i64,
    pub name: String,
    pub profile_type: String,
    pub can_access_private: bool,
    pub can_manage_global_settings: bool,
    pub can_manage_profiles: bool,
    pub created_at: String,
    /// Hash Argon2id (chaîne PHC) du mot de passe — `None` si le profil
    /// n'a pas de mot de passe (accès direct, Étape 6c).
    pub password_hash: Option<String>,
    /// Hash Argon2id du code de récupération (Étape 6c) — `None` si
    /// aucun code n'a été généré.
    pub recovery_code_hash: Option<String>,
}

const SELECT_COLUMNS: &str = "id, name, profile_type, can_access_private, \
    can_manage_global_settings, can_manage_profiles, created_at, \
    password_hash, recovery_code_hash";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<ProfileRecord> {
    Ok(ProfileRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        profile_type: row.get(2)?,
        can_access_private: row.get(3)?,
        can_manage_global_settings: row.get(4)?,
        can_manage_profiles: row.get(5)?,
        created_at: row.get(6)?,
        password_hash: row.get(7)?,
        recovery_code_hash: row.get(8)?,
    })
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<ProfileRecord>> {
    let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLUMNS} FROM profiles ORDER BY id"))?;
    let rows = stmt.query_map([], map_row)?;
    rows.collect()
}

pub fn get_by_id(conn: &Connection, id: i64) -> rusqlite::Result<Option<ProfileRecord>> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM profiles WHERE id = ?1"),
        rusqlite::params![id],
        map_row,
    )
    .optional()
}

/// Premier profil disposant de `can_manage_profiles`, par ordre de
/// création — c'est celui réactivé automatiquement à chaque lancement de
/// l'application (doc §6.5). `None` seulement si aucun profil administrateur
/// n'existe, situation que l'application ne devrait jamais atteindre
/// (`delete` l'empêche explicitement, voir `domain::profile`).
pub fn first_profile_with_manage_profiles(conn: &Connection) -> rusqlite::Result<Option<ProfileRecord>> {
    conn.query_row(
        &format!(
            "SELECT {SELECT_COLUMNS} FROM profiles WHERE can_manage_profiles = 1 ORDER BY id ASC LIMIT 1"
        ),
        [],
        map_row,
    )
    .optional()
}

/// Nombre de profils disposant de `can_manage_profiles` — utilisé pour
/// interdire la suppression du dernier d'entre eux.
pub fn count_with_manage_profiles(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM profiles WHERE can_manage_profiles = 1",
        [],
        |row| row.get(0),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn create(
    conn: &Connection,
    name: &str,
    profile_type: &str,
    can_access_private: bool,
    can_manage_global_settings: bool,
    can_manage_profiles: bool,
) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO profiles
            (name, profile_type, can_access_private, can_manage_global_settings, can_manage_profiles, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            name,
            profile_type,
            can_access_private,
            can_manage_global_settings,
            can_manage_profiles,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE profiles SET name = ?1 WHERE id = ?2",
        rusqlite::params![name, id],
    )?;
    Ok(())
}

pub fn update_permissions(
    conn: &Connection,
    id: i64,
    can_access_private: bool,
    can_manage_global_settings: bool,
    can_manage_profiles: bool,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE profiles
         SET can_access_private = ?1, can_manage_global_settings = ?2, can_manage_profiles = ?3
         WHERE id = ?4",
        rusqlite::params![can_access_private, can_manage_global_settings, can_manage_profiles, id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM profiles WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

/// Met à jour les champs d'authentification d'un profil (mot de passe
/// et/ou code de récupération). `None` supprime le champ (profil sans
/// mot de passe / sans code de récupération).
pub fn update_auth(
    conn: &Connection,
    id: i64,
    password_hash: Option<&str>,
    recovery_code_hash: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE profiles SET password_hash = ?1, recovery_code_hash = ?2 WHERE id = ?3",
        rusqlite::params![password_hash, recovery_code_hash, id],
    )?;
    Ok(())
}