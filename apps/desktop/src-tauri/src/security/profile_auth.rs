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
/// 
/// Politique de mot de passe (Fix P1 - Sécurité) :
/// - Minimum 8 caractères
/// - Au moins une majuscule
/// - Au moins une minuscule  
/// - Au moins un chiffre
/// - Au moins un caractère spécial
pub fn hash_password(password: &str) -> Result<String, String> {
    // Validation de la politique de mot de passe
    validate_password_policy(password)?;
    
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Échec du hash du mot de passe : {e}"))?;
    Ok(hash.to_string())
}

/// Type de secret d'un profil (0.7.9) : un mot de passe complet ou un code PIN.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    Password,
    Pin,
}

/// Longueurs autorisées d'un PIN.
pub const PIN_MIN_LENGTH: usize = 4;
pub const PIN_MAX_LENGTH: usize = 8;

impl SecretKind {
    /// `None` = mot de passe (valeur d'origine des anciennes versions).
    pub fn parse(raw: Option<&str>) -> Result<SecretKind, String> {
        match raw {
            None | Some("password") => Ok(SecretKind::Password),
            Some("pin") => Ok(SecretKind::Pin),
            Some(other) => Err(format!("Type de secret inconnu : {other}")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SecretKind::Password => "password",
            SecretKind::Pin => "pin",
        }
    }
}

/// Hash un secret (mot de passe OU PIN) après validation de la politique propre
/// à son type. La vérification (`verify_password`) est la même pour les deux.
///
/// Un PIN n'est PAS un mot de passe fort : 4 à 8 chiffres seulement, et le fichier
/// de base de données n'est pas chiffré. Il protège contre un autre utilisateur de
/// la même session (l'accès à l'application et aux profils), pas contre quelqu'un
/// qui lit le disque. Les essais successifs sont ralentis (`login_throttle`).
pub fn hash_secret(secret: &str, kind: SecretKind) -> Result<String, String> {
    match kind {
        SecretKind::Password => hash_password(secret),
        SecretKind::Pin => {
            validate_pin_policy(secret)?;
            hash_unchecked(secret)
        }
    }
}

/// Politique du PIN : uniquement des chiffres, de 4 à 8.
pub fn validate_pin_policy(pin: &str) -> Result<(), String> {
    let length = pin.chars().count();
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("Le code PIN ne doit contenir que des chiffres.".to_string());
    }
    if !(PIN_MIN_LENGTH..=PIN_MAX_LENGTH).contains(&length) {
        return Err(format!(
            "Le code PIN doit contenir entre {PIN_MIN_LENGTH} et {PIN_MAX_LENGTH} chiffres."
        ));
    }
    Ok(())
}

fn hash_unchecked(secret: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("Échec du hash du secret : {e}"))
}

/// Valide qu'un mot de passe respecte la politique de sécurité
fn validate_password_policy(password: &str) -> Result<(), String> {
    if password.len() < 8 {
        return Err("Le mot de passe doit contenir au moins 8 caractères.".to_string());
    }
    if !password.chars().any(|c| c.is_uppercase()) {
        return Err("Le mot de passe doit contenir au moins une lettre majuscule.".to_string());
    }
    if !password.chars().any(|c| c.is_lowercase()) {
        return Err("Le mot de passe doit contenir au moins une lettre minuscule.".to_string());
    }
    if !password.chars().any(|c| c.is_ascii_digit()) {
        return Err("Le mot de passe doit contenir au moins un chiffre.".to_string());
    }
    if !password.chars().any(|c| !c.is_alphanumeric()) {
        return Err("Le mot de passe doit contenir au moins un caractère spécial.".to_string());
    }
    Ok(())
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

    // Le code est un secret aléatoire de 16 caractères (80 bits) : il n'est PAS un
    // mot de passe saisi par l'utilisateur et ne doit donc pas passer par la
    // politique des mots de passe. Avant 0.7.9 il y passait — et cette politique
    // exige une minuscule, que ce code (majuscules et chiffres) n'a jamais : la
    // génération échouait TOUJOURS, donc définir un mot de passe (création d'un
    // compte, réinitialisation, récupération) échouait systématiquement.
    let hash = hash_unchecked(&code)?;
    Ok((code, hash))
}

/// Vérifie un code de récupération contre son hash (même logique que
/// `verify_password`, mais séparé pour la clarté sémantique).
pub fn verify_recovery_code(code: &str, hash: &str) -> Result<bool, String> {
    verify_password(code, hash)
}

#[cfg(test)]
mod secret_tests {
    use super::*;

    #[test]
    fn pin_accepte_4_a_8_chiffres() {
        for pin in ["1234", "0000", "123456", "12345678"] {
            assert!(validate_pin_policy(pin).is_ok(), "{pin} devrait être accepté");
        }
    }

    #[test]
    fn pin_refuse_longueur_et_caracteres_invalides() {
        assert!(validate_pin_policy("123").is_err()); // trop court
        assert!(validate_pin_policy("123456789").is_err()); // trop long
        assert!(validate_pin_policy("12a4").is_err());
        assert!(validate_pin_policy("12 34").is_err());
        assert!(validate_pin_policy("").is_err());
        assert!(validate_pin_policy("１２３４").is_err()); // chiffres pleine chasse, pas ASCII
        assert!(validate_pin_policy("-123").is_err());
    }

    #[test]
    fn un_pin_n_est_pas_soumis_a_la_politique_des_mots_de_passe() {
        // « 1234 » serait refusé comme mot de passe (8 caractères, majuscule…)
        // mais est un PIN valide.
        assert!(hash_secret("1234", SecretKind::Password).is_err());
        let hash = hash_secret("1234", SecretKind::Pin).expect("PIN valide");
        assert!(verify_password("1234", &hash).unwrap());
        assert!(!verify_password("1235", &hash).unwrap());
    }

    #[test]
    fn un_mot_de_passe_reste_soumis_a_sa_politique() {
        assert!(hash_secret("Secret#2026", SecretKind::Password).is_ok());
        assert!(hash_secret("motdepasse", SecretKind::Password).is_err());
        // Un mot de passe n'est pas accepté en tant que PIN.
        assert!(hash_secret("Secret#2026", SecretKind::Pin).is_err());
    }

    #[test]
    fn le_code_de_recuperation_se_genere_et_se_verifie() {
        // Régression : la génération échouait toujours (politique des mots de passe
        // appliquée à un code sans minuscule).
        for _ in 0..3 {
            let (code, hash) = generate_recovery_code().expect("génération du code de récupération");
            assert_eq!(code.len(), 19);
            assert!(code.chars().all(|c| c == '-' || c.is_ascii_uppercase() || c.is_ascii_digit()));
            assert!(verify_recovery_code(&code, &hash).unwrap());
            assert!(!verify_recovery_code("AAAA-AAAA-AAAA-AAAA", &hash).unwrap());
        }
    }

    #[test]
    fn type_de_secret_inconnu_est_refuse() {
        assert_eq!(SecretKind::parse(None), Ok(SecretKind::Password));
        assert_eq!(SecretKind::parse(Some("password")), Ok(SecretKind::Password));
        assert_eq!(SecretKind::parse(Some("pin")), Ok(SecretKind::Pin));
        assert!(SecretKind::parse(Some("biometrie")).is_err());
        assert_eq!(SecretKind::Pin.as_str(), "pin");
    }
}
