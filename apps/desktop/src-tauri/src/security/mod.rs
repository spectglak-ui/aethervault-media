//! Privacy/Security Manager (Étape 6a, doc §4.2/§6.4/§6.4 bis).
//!
//! Regroupe tout ce qui touche à l'authentification et au chiffrement du
//! coffre privé : dérivation de clé (`kdf`), cycle de vie de `vault.db`
//! (`vault`), et modèle de permissions de profil (`permissions`, partagé
//! avec le Profile Manager — `domain::profile`).
//!
//! Aucune requête SQL propre à `vault.db` ne doit être écrite en dehors de
//! ce module et de `domain::privacy`, même principe que pour
//! `aethervault.db` et `db/`.

pub mod kdf;
pub mod permissions;
pub mod vault;
pub mod profile_auth;