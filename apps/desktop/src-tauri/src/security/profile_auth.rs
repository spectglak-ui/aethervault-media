//! Authentification des profils (Étape 6c, doc §6.5).
//!
//! Hash Argon2id du mot de passe (chaîne PHC standard, stockée dans
//! `profiles.password_hash`) et génération/vérification du code de
//! récupération (format `XXXX-XXXX-XXXX-XXXX`, affiché une fois à la
//! création puis stocké hashé dans `profiles.recovery_code_hash`).
//!
//! Distinct de `security::kdf` (qui dérive une clé AES pour le coffre
//! privé) : ici on hash un mot de passe pour vérification par comparaison,
//! pas pour dériver une clé de chiffrement. Les paramètres Argon2id
//! peuvent donc être différents (plus légers, puisqu'on n'a pas besoin
//! de résister à un attaquant qui aurait volé la base — le fichier
//! `aethervault.db` n'est pas chiffré, contrairement à `vault.db`).

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::Rng;

/// Longueur du code de récupération (4 groupes de 4 caractères, séparés
/// par des tirets — ex. `A1B2-C3D4-E5F6-G7H8`).
const RECOVERY_CODE_LENGTH: usize = 16;
const RECOVERY_CODE_GROUP_SIZE: usize = 4;

/// Caractères utilisés pour le code de récupération — alphabet lisible
/// (pas de `0`/`O`/`1`/`I`/`l` ambigus), majuscules uniquement pour
/// simplifier la saisie.
const RECOVERY_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// Hash un mot de passe avec Argon2id (chaîne PHC standard, ex.
/// `$argon2id$v=19$m=19456,t=2,p=1$...`). Les paramètres par défaut
/// d'Argon2 (19 MiB mémoire, 2 itérations, 1 thread) sont suffisants
/// pour un fichier local non chiffré.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Échec du hash du mot de passe : {e}"))?;
    Ok(hash.to_string())
}

/// Vérifie un mot de passe contre un hash Argon2id (chaîne PHC).
/// Renvoie `Ok(true)` si valide, `Ok(false)` si invalide, `Err` si le
/// hash stocké est corrompu (ne devrait jamais arriver avec un hash
/// généré par `hash_password`).
pub fn verify_password(password: &str, hash: &str) -> Result<bool, String> {
    let parsed =
        PasswordHash::new(hash).map_err(|e| format!("Hash de mot de passe invalide : {e}"))?;
    let argon2 = Argon2::default();
    Ok(argon2.verify_password(password.as_bytes(), &parsed).is_ok())
}

/// Génère un code de récupération aléatoire (format `XXXX-XXXX-XXXX-XXXX`),
/// le hash avec Argon2id, et renvoie les deux : le code en clair (à
/// afficher une fois à l'utilisateur) et son hash (à stocker en base).
pub fn generate_recovery_code() -> Result<(String, String), String> {
    let mut rng = rand::thread_rng();
    let mut code_chars: Vec<char> = Vec::with_capacity(RECOVERY_CODE_LENGTH);
    for _ in 0..RECOVERY_CODE_LENGTH {
        let index = rng.gen_range(0..RECOVERY_CODE_ALPHABET.len());
        code_chars.push(RECOVERY_CODE_ALPHABET[index] as char);
    }

    // Formate en groupes de 4 séparés par des tirets
    let code: String = code_chars
        .chunks(RECOVERY_CODE_GROUP_SIZE)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-");

    let hash = hash_password(&code)?;
    Ok((code, hash))
}

/// Vérifie un code de récupération contre son hash (même logique que
/// `verify_password`, mais séparé pour la clarté sémantique).
pub fn verify_recovery_code(code: &str, hash: &str) -> Result<bool, String> {
    verify_password(code, hash)
}