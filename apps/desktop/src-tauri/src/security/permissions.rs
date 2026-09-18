//! Modèle de permissions de profil — doc §6.5, décision C3 (hybride).
//!
//! `profile_type` détermine des permissions **par défaut** à la création
//! d'un profil (correspondance codée ici, pas en base) ; elles sont ensuite
//! matérialisées par trois colonnes explicites sur `profiles`, modifiables
//! individuellement par la suite par un profil disposant de
//! `can_manage_profiles`. Couvre le cas "personnalisé" de la doc sans
//! moteur de permissions générique séparé.

use serde::{Deserialize, Serialize};

/// Types de profil connus, utilisés uniquement pour calculer les
/// permissions par défaut à la création — `profiles.profile_type` reste une
/// colonne texte libre en base (pas de `CHECK`), pour ne pas fermer la
/// porte à un libellé "personnalisé" au sens de la doc.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProfileType {
    Admin,
    User,
    Guest,
    Child,
    /// Type "personnalisé" (doc §6.5) : aucune permission accordée par
    /// défaut, à régler explicitement par un Administrateur après création.
    Custom,
}

impl ProfileType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProfileType::Admin => "admin",
            ProfileType::User => "user",
            ProfileType::Guest => "guest",
            ProfileType::Child => "child",
            ProfileType::Custom => "custom",
        }
    }

    /// Toute valeur inconnue (y compris `"custom"`) retombe sur `Custom` —
    /// aucune permission par défaut plutôt qu'une supposition dangereuse.
    pub fn from_str(value: &str) -> Self {
        match value {
            "admin" => ProfileType::Admin,
            "user" => ProfileType::User,
            "guest" => ProfileType::Guest,
            "child" => ProfileType::Child,
            _ => ProfileType::Custom,
        }
    }
}

/// Les trois permissions explicites de la doc §9 : accès à la catégorie
/// Privé, modification des paramètres globaux, gestion des autres profils.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ProfilePermissions {
    pub can_access_private: bool,
    pub can_manage_global_settings: bool,
    pub can_manage_profiles: bool,
}

/// Permissions par défaut à la création d'un profil du type donné.
/// Toujours modifiables ensuite : ce ne sont que des valeurs de départ, pas
/// une contrainte permanente liée au type.
pub fn defaults_for(profile_type: ProfileType) -> ProfilePermissions {
    match profile_type {
        ProfileType::Admin => ProfilePermissions {
            can_access_private: true,
            can_manage_global_settings: true,
            can_manage_profiles: true,
        },
        ProfileType::User => ProfilePermissions {
            can_access_private: false,
            can_manage_global_settings: false,
            can_manage_profiles: false,
        },
        ProfileType::Guest => ProfilePermissions {
            can_access_private: false,
            can_manage_global_settings: false,
            can_manage_profiles: false,
        },
        ProfileType::Child => ProfilePermissions {
            can_access_private: false,
            can_manage_global_settings: false,
            can_manage_profiles: false,
        },
        ProfileType::Custom => ProfilePermissions {
            can_access_private: false,
            can_manage_global_settings: false,
            can_manage_profiles: false,
        },
    }
}
