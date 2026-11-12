//! Secret d'un profil — mot de passe OU code PIN (0.7.9).
//!
//! Un secret se VALIDE et se hashe d'abord (`prepare_secret`), puis s'ÉCRIT
//! (`apply_secret`) : ainsi un secret refusé par la politique n'abîme jamais l'état
//! — avant, `setup_first_admin` créait le profil PUIS hashait le mot de passe ;
//! un mot de passe trop faible laissait donc un administrateur sans mot de passe
//! et bloquait le formulaire (« Un profil existe déjà » au second essai).
//!
//! Chaque (re)définition d'un secret génère un NOUVEAU code de récupération (le
//! précédent n'est plus valable) ; il n'est affiché qu'une fois.

use rusqlite::Connection;

use crate::db::repositories::profile_repository;
use crate::security::profile_auth::{self, SecretKind};

/// Secret validé et hashé, prêt à être écrit.
pub struct PreparedSecret {
    hash: String,
    kind: SecretKind,
    /// Code de récupération en clair, à montrer une seule fois.
    pub recovery_code: String,
    recovery_hash: String,
}

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

pub fn prepare_secret(secret: &str, kind: Option<&str>) -> Result<PreparedSecret, String> {
    let kind = SecretKind::parse(kind)?;
    let hash = profile_auth::hash_secret(secret, kind)?;
    let (recovery_code, recovery_hash) = profile_auth::generate_recovery_code()?;
    Ok(PreparedSecret { hash, kind, recovery_code, recovery_hash })
}

pub fn apply_secret(conn: &Connection, profile_id: i64, prepared: &PreparedSecret) -> Result<(), String> {
    profile_repository::update_auth_with_kind(
        conn,
        profile_id,
        Some(&prepared.hash),
        Some(&prepared.recovery_hash),
        Some(prepared.kind.as_str()),
    )
    .map_err(db_err)
}

/// Définit (`Some`) ou retire (`None`) le secret d'un profil. Renvoie le nouveau
/// code de récupération quand un secret est défini.
pub fn set_secret(
    conn: &Connection,
    profile_id: i64,
    secret: Option<&str>,
    kind: Option<&str>,
) -> Result<Option<String>, String> {
    match secret {
        Some(secret) => {
            let prepared = prepare_secret(secret, kind)?;
            apply_secret(conn, profile_id, &prepared)?;
            Ok(Some(prepared.recovery_code))
        }
        None => {
            profile_repository::update_auth_with_kind(conn, profile_id, None, None, None).map_err(db_err)?;
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::MIGRATIONS;

    /// Les tables VaultTube sont créées hors migrations mais modifiées par elles.
    fn open(max_version: i32) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             CREATE TABLE vaulttube_subscriptions (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_videos (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_playlists (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_user_playlists (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_user_playlist_items (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= max_version) {
            conn.execute_batch(m.sql).unwrap_or_else(|e| panic!("migration {} : {e}", m.version));
        }
        conn
    }

    fn new_profile(conn: &Connection, name: &str) -> i64 {
        profile_repository::create(conn, name, "Utilisateur", false, false, false).unwrap()
    }

    fn record(conn: &Connection, id: i64) -> profile_repository::ProfileRecord {
        profile_repository::get_by_id(conn, id).unwrap().unwrap()
    }

    #[test]
    fn un_pin_est_stocke_avec_son_type_et_un_code_de_recuperation() {
        let conn = open(i32::MAX);
        let id = new_profile(&conn, "Camille");
        let code = set_secret(&conn, id, Some("4821"), Some("pin")).unwrap().expect("code de récupération");
        assert_eq!(code.len(), 19); // XXXX-XXXX-XXXX-XXXX
        let r = record(&conn, id);
        assert_eq!(r.auth_kind.as_deref(), Some("pin"));
        assert!(profile_auth::verify_password("4821", r.password_hash.as_deref().unwrap()).unwrap());
        assert!(profile_auth::verify_recovery_code(&code, r.recovery_code_hash.as_deref().unwrap()).unwrap());
    }

    #[test]
    fn mot_de_passe_par_defaut_puis_remplacement_par_un_pin_et_retrait() {
        let conn = open(i32::MAX);
        let id = new_profile(&conn, "Alex");
        let first = set_secret(&conn, id, Some("Secret#2026"), None).unwrap().unwrap();
        assert_eq!(record(&conn, id).auth_kind.as_deref(), Some("password"));
        // Changer de secret invalide l'ancien code de récupération.
        let second = set_secret(&conn, id, Some("9087"), Some("pin")).unwrap().unwrap();
        assert_ne!(first, second);
        let r = record(&conn, id);
        assert_eq!(r.auth_kind.as_deref(), Some("pin"));
        assert!(!profile_auth::verify_recovery_code(&first, r.recovery_code_hash.as_deref().unwrap()).unwrap());
        // Retrait : plus de secret, plus de type, plus de code.
        assert_eq!(set_secret(&conn, id, None, None).unwrap(), None);
        let r = record(&conn, id);
        assert!((r.password_hash.is_none(), r.recovery_code_hash.is_none(), r.auth_kind.is_none()) == (true, true, true));
    }

    #[test]
    fn un_secret_refuse_ne_modifie_rien() {
        let conn = open(i32::MAX);
        let id = new_profile(&conn, "Sam");
        set_secret(&conn, id, Some("1234"), Some("pin")).unwrap();
        let before = record(&conn, id).password_hash;
        assert!(set_secret(&conn, id, Some("12"), Some("pin")).is_err()); // PIN trop court
        assert!(set_secret(&conn, id, Some("faible"), None).is_err()); // mot de passe trop faible
        assert!(set_secret(&conn, id, Some("1234"), Some("biometrie")).is_err());
        let after = record(&conn, id);
        assert_eq!(after.password_hash, before);
        assert_eq!(after.auth_kind.as_deref(), Some("pin"));
    }

    #[test]
    fn l_ancienne_fonction_update_auth_pose_un_mot_de_passe() {
        let conn = open(i32::MAX);
        let id = new_profile(&conn, "Ancien");
        profile_repository::update_auth(&conn, id, Some("hash"), Some("code")).unwrap();
        assert_eq!(record(&conn, id).auth_kind.as_deref(), Some("password"));
        profile_repository::update_auth(&conn, id, None, None).unwrap();
        assert_eq!(record(&conn, id).auth_kind, None);
    }

    /// Mise à jour d'une base existante : les secrets déjà posés sont des mots de passe.
    #[test]
    fn la_migration_29_marque_les_secrets_existants_comme_mots_de_passe() {
        let conn = open(28);
        conn.execute_batch(
            "INSERT INTO profiles (id, name, profile_type, created_at, password_hash) VALUES (1, 'Avec', 'admin', 'x', '$argon2id$x');
             INSERT INTO profiles (id, name, profile_type, created_at) VALUES (2, 'Sans', 'user', 'x');",
        )
        .unwrap();
        let sql = MIGRATIONS.iter().find(|m| m.version == 29).unwrap().sql;
        conn.execute_batch(sql).unwrap();
        assert_eq!(record(&conn, 1).auth_kind.as_deref(), Some("password"));
        assert_eq!(record(&conn, 2).auth_kind, None);
        // La contrainte refuse un type inconnu.
        assert!(conn.execute("UPDATE profiles SET auth_kind = 'autre' WHERE id = 2", []).is_err());
    }
}
