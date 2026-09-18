//! Dérivation de clé (KDF) pour le coffre privé — doc §6.4 bis.
//!
//! Argon2id est utilisé exclusivement comme fonction de dérivation de clé :
//! le PIN/mot de passe saisi par l'utilisateur n'est **jamais stocké**, ni
//! en clair ni sous forme de hash à comparer. Seuls le sel et les
//! paramètres (non secrets par nature) sont conservés, dans la table
//! `vault_security` de `aethervault.db` — voir
//! `db::repositories::vault_security_repository`. Une entrée incorrecte ne
//! produit pas une erreur ici : elle produit silencieusement une clé
//! différente, que la vérification d'authenticité d'AES-GCM refusera
//! ensuite de déchiffrer (`security::vault::unlock`).

use argon2::{Algorithm, Argon2, Params, Version};
use rand::rngs::OsRng;
use rand::RngCore;

/// Longueur du sel Argon2id, en octets.
pub const SALT_LEN: usize = 16;
/// Longueur de la clé dérivée, en octets — 256 bits, la taille attendue
/// par une clé AES-256-GCM (`security::vault`).
pub const KEY_LEN: usize = 32;

/// Paramètres Argon2id par défaut, appliqués au premier réglage du
/// PIN/mot de passe (ou lors d'un changement — `change_secret` régénère un
/// sel avec ces mêmes valeurs). Volontairement plus coûteux que les
/// recommandations "authentification web" habituelles : cette dérivation
/// n'a lieu qu'une fois par déverrouillage (pas par requête réseau), un
/// coût plus élevé est un compromis raisonnable face à une attaque
/// hors-ligne sur un `vault.db` dérobé.
pub const DEFAULT_MEM_COST_KIB: u32 = 65536; // 64 Mio
pub const DEFAULT_TIME_COST: u32 = 3;
pub const DEFAULT_PARALLELISM: u32 = 1;

/// Sel et paramètres Argon2id associés à un coffre — jamais le secret
/// lui-même. Miroir de `VaultSecurityRecord` (repository), sous une forme
/// pratique pour `Argon2::new`.
pub struct KdfParams {
    pub salt: Vec<u8>,
    pub mem_cost_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
}

impl KdfParams {
    /// Génère un nouveau sel aléatoire avec les paramètres par défaut —
    /// appelé uniquement à la création du coffre ou à un changement de
    /// secret, jamais à un simple déverrouillage (qui réutilise le sel
    /// déjà enregistré).
    pub fn generate() -> Self {
        let mut salt = vec![0u8; SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        KdfParams {
            salt,
            mem_cost_kib: DEFAULT_MEM_COST_KIB,
            time_cost: DEFAULT_TIME_COST,
            parallelism: DEFAULT_PARALLELISM,
        }
    }
}

/// Dérive la clé AES 256 bits utilisée pour chiffrer/déchiffrer `vault.db`
/// (AES-256-GCM, voir `security::vault`) à partir du secret
/// saisi par l'utilisateur et des paramètres stockés.
pub fn derive_key(secret: &str, params: &KdfParams) -> Result<[u8; KEY_LEN], String> {
    let argon2_params = Params::new(
        params.mem_cost_kib,
        params.time_cost,
        params.parallelism,
        Some(KEY_LEN),
    )
    .map_err(|e| format!("paramètres Argon2id invalides : {e}"))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);

    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(secret.as_bytes(), &params.salt, &mut key)
        .map_err(|e| format!("échec de la dérivation Argon2id : {e}"))?;

    Ok(key)
}
