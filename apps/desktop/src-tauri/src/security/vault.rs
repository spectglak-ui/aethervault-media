//! Cycle de vie du coffre privé chiffré (`vault.db`) — doc §6.4 bis.
//!
//! **Architecture A2** (AES-256-GCM applicatif), retenue après abandon de
//! SQLCipher en cours d'Étape 6a suite à un échec de compilation d'OpenSSL
//! sur la machine de développement — voir l'erratum en doc §6.4 bis.
//!
//! `vault.db` n'est plus un fichier SQLite ouvrable directement : c'est un
//! blob chiffré (AES-256-GCM, authentifié) contenant un instantané complet
//! d'une base SQLite tenue **en mémoire** (`Connection::open_in_memory`)
//! pendant toute la durée où le coffre est déverrouillé.
//!
//! `rusqlite` (feature `backup`) ne permet de transférer le contenu d'une
//! connexion que vers/depuis un chemin de fichier, jamais directement vers
//! un tampon en mémoire : un fichier de travail temporaire (`vault.tmp`,
//! dans le répertoire de données de l'application) sert uniquement de
//! support de transfert, écrit puis relu (ou relu puis supprimé) en une
//! fraction de seconde à chaque déverrouillage ou persistance, jamais
//! laissé sur disque au repos. `vault.db` est ré-écrit après **chaque
//! opération d'écriture**, pas seulement à la fermeture (voir
//! `VaultHandle::persist` et son appel dans `domain::privacy`) : point
//! affiné par rapport à la description initiale de l'option A2, pour ne
//! jamais perdre une opération déjà confirmée au frontend en cas d'arrêt
//! brutal de l'application.

use crate::db::repositories::vault_security_repository::{self, VaultSecurityRecord};
use crate::db::DbPool;
use crate::security::kdf::{self, KdfParams, KEY_LEN};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;
use rusqlite::{Connection, DatabaseName};
use std::path::{Path, PathBuf};

/// Préfixe de format du fichier `vault.db`, pour distinguer un fichier
/// corrompu ou d'un format futur incompatible d'un simple échec de
/// déchiffrement (mauvais PIN/mot de passe).
const FORMAT_MAGIC: &[u8; 4] = b"AVV1";
/// Taille standard d'un nonce AES-GCM (96 bits).
const NONCE_LEN: usize = 12;

/// Une migration de schéma propre à `vault.db`, sur le même principe que
/// `db::migrations::Migration` mais volontairement séparée : les deux
/// bases n'évoluent pas au même rythme (ex. l'Étape 6b ajoutera des tables
/// ici sans toucher `aethervault.db`). Suivies via `PRAGMA user_version`
/// de la connexion en mémoire — fidèlement conservé par `backup`/`restore`
/// au même titre que le reste du contenu.
struct VaultMigration {
    version: i32,
    sql: &'static str,
}

const VAULT_MIGRATIONS: &[VaultMigration] = &[
    VaultMigration {
        version: 1,
        sql: include_str!("vault_migrations/0001_private_libraries.sql"),
    },
    VaultMigration {
        version: 2,
        sql: include_str!("vault_migrations/0002_private_video.sql"),
    },
    VaultMigration {
        version: 3,
        sql: include_str!("vault_migrations/0003_private_image.sql"),
    },
];

/// Poignée vers un coffre déverrouillé : la connexion SQLite en mémoire
/// elle-même, plus la clé (nécessaire pour re-chiffrer à chaque
/// persistance) et les chemins de fichiers. Tenue en mémoire uniquement,
/// dans `AppState` (`VaultState`) — jamais persistée telle quelle, comme
/// l'exige la doc §6.4 : redemandée à chaque lancement de l'application.
///
/// Pas de pool de connexions ici (contrairement à `aethervault.db`) : une
/// seule connexion en mémoire par coffre déverrouillé suffit très
/// largement pour un catalogue de métadonnées de cette taille, et évite la
/// classe de bug qu'un pool aurait introduite avec un mécanisme de type
/// "changement de clé" (plusieurs connexions désynchronisées sur la clé
/// courante) — non-problème ici puisqu'il n'y a qu'une connexion, jamais
/// un pool.
pub struct VaultHandle {
    conn: Connection,
    key: [u8; KEY_LEN],
    vault_path: PathBuf,
    tmp_path: PathBuf,
}

impl VaultHandle {
    /// Connexion en mémoire du coffre déverrouillé — lecture/écriture des
    /// bibliothèques privées (`db::repositories::private_repository`).
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    /// Ré-écrit `vault.db` avec l'état actuel de la base en mémoire,
    /// chiffré avec un nonce neuf à chaque appel. Appelée après chaque
    /// opération d'écriture par `domain::privacy` — jamais seulement à la
    /// fermeture (voir la note de tête de ce module).
    pub fn persist(&self) -> Result<(), String> {
        let _ = std::fs::remove_file(&self.tmp_path);
        self.conn
            .backup(DatabaseName::Main, &self.tmp_path, None::<fn(rusqlite::backup::Progress)>)
            .map_err(|e| e.to_string())?;

        let plaintext = std::fs::read(&self.tmp_path).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&self.tmp_path);

        write_encrypted(&self.vault_path, &self.key, &plaintext)
    }
}

/// État du coffre, porté par `AppState`. `Locked` par défaut à chaque
/// lancement — jamais restauré automatiquement, même si le coffre avait
/// été déverrouillé lors d'une session précédente.
pub enum VaultState {
    Locked,
    Unlocked(VaultHandle),
}

impl VaultState {
    pub fn is_unlocked(&self) -> bool {
        matches!(self, VaultState::Unlocked(_))
    }

    pub fn connection(&self) -> Option<&Connection> {
        match self {
            VaultState::Unlocked(handle) => Some(handle.connection()),
            VaultState::Locked => None,
        }
    }

    /// Persiste immédiatement si le coffre est déverrouillé, ne fait rien
    /// sinon (aucune commande ne devrait pouvoir écrire alors que le
    /// coffre est verrouillé, mais ce n'est pas une erreur en soi d'appeler
    /// cette fonction dans cet état).
    pub fn persist_if_unlocked(&self) -> Result<(), String> {
        match self {
            VaultState::Unlocked(handle) => handle.persist(),
            VaultState::Locked => Ok(()),
        }
    }
}

/// Chemin du fichier `vault.db`, à côté de `aethervault.db` dans le
/// répertoire de données de l'application.
pub fn vault_path(data_dir: &Path) -> PathBuf {
    data_dir.join("vault.db")
}

fn tmp_path(data_dir: &Path) -> PathBuf {
    data_dir.join("vault.tmp")
}

/// À appeler une fois au démarrage de l'application (`lib.rs`) : supprime
/// un éventuel fichier de travail resté sur disque après un arrêt brutal
/// pendant un déverrouillage ou une persistance — fenêtre de l'ordre de la
/// milliseconde, mais pas nulle (voir la note de tête de ce module).
/// Best-effort : une erreur ici (permissions, etc.) ne doit jamais
/// empêcher le démarrage de l'application.
pub fn cleanup_stale_temp_file(data_dir: &Path) {
    let _ = std::fs::remove_file(tmp_path(data_dir));
}

/// Le coffre a-t-il déjà été initialisé (un PIN/mot de passe a-t-il déjà
/// été réglé) ? Lu depuis `aethervault.db` — c'est justement l'information
/// qu'il faut avant de pouvoir tenter de déchiffrer `vault.db`.
pub fn is_initialized(pool: &DbPool) -> Result<bool, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    vault_security_repository::get(&conn)
        .map(|record| record.is_some())
        .map_err(|e| e.to_string())
}

/// Premier réglage du PIN/mot de passe : génère un sel, dérive la clé,
/// crée une base SQLite en mémoire, y applique les migrations, la persiste
/// aussitôt (chiffrée) sur disque, puis enregistre le sel/paramètres
/// (jamais le secret) dans `aethervault.db`. Échoue si un coffre existe
/// déjà (voir `change_secret` pour un changement).
pub fn initialize(
    pool: &DbPool,
    data_dir: &Path,
    secret_kind: &str,
    secret: &str,
) -> Result<VaultHandle, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    if vault_security_repository::get(&conn)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("Un coffre privé existe déjà pour cette installation.".to_string());
    }

    let params = KdfParams::generate();
    let key = kdf::derive_key(secret, &params)?;

    let working_conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    apply_vault_migrations(&working_conn)?;

    let handle = VaultHandle {
        conn: working_conn,
        key,
        vault_path: vault_path(data_dir),
        tmp_path: tmp_path(data_dir),
    };
    handle.persist()?;

    vault_security_repository::save(
        &conn,
        &VaultSecurityRecord {
            secret_kind: secret_kind.to_string(),
            kdf_salt: params.salt,
            kdf_mem_cost_kib: params.mem_cost_kib as i64,
            kdf_time_cost: params.time_cost as i64,
            kdf_parallelism: params.parallelism as i64,
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(handle)
}

/// Tente de déverrouiller le coffre avec le secret fourni. Une clé
/// incorrecte est détectée par l'échec (attendu) de la vérification
/// d'authenticité intégrée à AES-GCM lors du déchiffrement — jamais par
/// comparaison d'un hash stocké (voir §6.4 bis).
pub fn unlock(pool: &DbPool, data_dir: &Path, secret: &str) -> Result<VaultHandle, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let record = vault_security_repository::get(&conn)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Aucun coffre privé n'a encore été créé.".to_string())?;

    let params = KdfParams {
        salt: record.kdf_salt,
        mem_cost_kib: record.kdf_mem_cost_kib as u32,
        time_cost: record.kdf_time_cost as u32,
        parallelism: record.kdf_parallelism as u32,
    };
    let key = kdf::derive_key(secret, &params)?;

    let vault_file = vault_path(data_dir);
    let plaintext =
        read_encrypted(&vault_file, &key).map_err(|_| "PIN ou mot de passe incorrect.".to_string())?;

    let tmp = tmp_path(data_dir);
    let _ = std::fs::remove_file(&tmp);
    std::fs::write(&tmp, &plaintext).map_err(|e| e.to_string())?;

    let mut working_conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    let restore_result = working_conn.restore(
        DatabaseName::Main,
        &tmp,
        None::<fn(rusqlite::backup::Progress)>,
    );
    let _ = std::fs::remove_file(&tmp);
    restore_result.map_err(|e| e.to_string())?;

    apply_vault_migrations(&working_conn)?;

    let handle = VaultHandle {
        conn: working_conn,
        key,
        vault_path: vault_file,
        tmp_path: tmp,
    };
    // Rechiffre systématiquement au déverrouillage : rend durable une
    // éventuelle migration tout juste appliquée, et fait tourner le nonce
    // à chaque déverrouillage (hygiène cryptographique supplémentaire,
    // sans contrainte particulière puisque le coût est négligeable pour un
    // catalogue de cette taille).
    handle.persist()?;

    Ok(handle)
}

/// Change le secret du coffre : dérive une nouvelle clé avec un nouveau
/// sel, puis re-persiste (re-chiffre) `vault.db` avec cette nouvelle clé —
/// aucun besoin de rouvrir quoi que ce soit, la connexion en mémoire reste
/// la même, seule la clé de chiffrement change.
pub fn change_secret(
    pool: &DbPool,
    handle: &mut VaultHandle,
    secret_kind: &str,
    new_secret: &str,
) -> Result<(), String> {
    let new_params = KdfParams::generate();
    let new_key = kdf::derive_key(new_secret, &new_params)?;

    handle.key = new_key;
    handle.persist()?;

    let conn = pool.get().map_err(|e| e.to_string())?;
    vault_security_repository::save(
        &conn,
        &VaultSecurityRecord {
            secret_kind: secret_kind.to_string(),
            kdf_salt: new_params.salt,
            kdf_mem_cost_kib: new_params.mem_cost_kib as i64,
            kdf_time_cost: new_params.time_cost as i64,
            kdf_parallelism: new_params.parallelism as i64,
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Chiffre `plaintext` (AES-256-GCM, nonce aléatoire neuf) et écrit
/// `[FORMAT_MAGIC][nonce][ciphertext]` à `path`.
fn write_encrypted(path: &Path, key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<(), String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "Échec du chiffrement du coffre.".to_string())?;

    let mut out = Vec::with_capacity(FORMAT_MAGIC.len() + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(FORMAT_MAGIC);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    std::fs::write(path, out).map_err(|e| e.to_string())
}

/// Lit et déchiffre `path`. Échoue aussi bien sur un fichier absent/
/// corrompu que sur une clé incorrecte (vérification d'authenticité
/// AES-GCM) — l'appelant (`unlock`) traduit toute erreur ici en "PIN ou
/// mot de passe incorrect", sans distinguer les deux cas pour ne pas
/// donner d'indice à une tentative par force brute.
fn read_encrypted(path: &Path, key: &[u8; KEY_LEN]) -> Result<Vec<u8>, String> {
    let raw = std::fs::read(path).map_err(|e| e.to_string())?;

    if raw.len() < FORMAT_MAGIC.len() + NONCE_LEN {
        return Err("Fichier de coffre corrompu ou tronqué.".to_string());
    }
    let (magic, rest) = raw.split_at(FORMAT_MAGIC.len());
    if magic != FORMAT_MAGIC {
        return Err("Format de fichier de coffre non reconnu.".to_string());
    }
    let (nonce_bytes, ciphertext) = rest.split_at(NONCE_LEN);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Échec du déchiffrement.".to_string())
}

fn apply_vault_migrations(conn: &Connection) -> Result<(), String> {
    let current_version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    for migration in VAULT_MIGRATIONS.iter().filter(|m| m.version > current_version) {
        conn.execute_batch(migration.sql)
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", migration.version)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
