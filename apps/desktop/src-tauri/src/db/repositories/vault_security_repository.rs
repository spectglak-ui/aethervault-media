//! Accès SQL à la table `vault_security` (doc §6.4 bis).
//!
//! Vit dans `aethervault.db` (non chiffrée), pas dans `vault.db` — c'est
//! justement l'information qu'il faut pouvoir lire *avant* de savoir dériver
//! la clé qui ouvrirait `vault.db`. Ne contient jamais le PIN/mot de passe :
//! uniquement le sel et les paramètres Argon2id (voir `security::kdf`).

use rusqlite::{Connection, OptionalExtension};

pub struct VaultSecurityRecord {
    pub secret_kind: String,
    pub kdf_salt: Vec<u8>,
    pub kdf_mem_cost_kib: i64,
    pub kdf_time_cost: i64,
    pub kdf_parallelism: i64,
}

/// `None` si aucun coffre n'a encore été créé sur cette installation.
pub fn get(conn: &Connection) -> rusqlite::Result<Option<VaultSecurityRecord>> {
    conn.query_row(
        "SELECT secret_kind, kdf_salt, kdf_mem_cost_kib, kdf_time_cost, kdf_parallelism
         FROM vault_security WHERE id = 1",
        [],
        |row| {
            Ok(VaultSecurityRecord {
                secret_kind: row.get(0)?,
                kdf_salt: row.get(1)?,
                kdf_mem_cost_kib: row.get(2)?,
                kdf_time_cost: row.get(3)?,
                kdf_parallelism: row.get(4)?,
            })
        },
    )
    .optional()
}

/// Crée ou remplace la ligne unique de configuration (création du coffre,
/// ou changement de secret — voir `security::vault::change_secret`).
pub fn save(conn: &Connection, record: &VaultSecurityRecord) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO vault_security
            (id, secret_kind, kdf_salt, kdf_mem_cost_kib, kdf_time_cost, kdf_parallelism, created_at, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET
            secret_kind = excluded.secret_kind,
            kdf_salt = excluded.kdf_salt,
            kdf_mem_cost_kib = excluded.kdf_mem_cost_kib,
            kdf_time_cost = excluded.kdf_time_cost,
            kdf_parallelism = excluded.kdf_parallelism,
            updated_at = excluded.updated_at",
        rusqlite::params![
            record.secret_kind,
            record.kdf_salt,
            record.kdf_mem_cost_kib,
            record.kdf_time_cost,
            record.kdf_parallelism,
            now,
        ],
    )?;
    Ok(())
}
