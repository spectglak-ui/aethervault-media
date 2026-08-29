//! Système de migrations versionnées de la base de données.
//!
//! Chaque migration est un fichier SQL numéroté (`000N_description.sql`),
//! appliqué une seule fois, dans l'ordre, et jamais modifié après coup
//! (toute correction se fait via une nouvelle migration). La version
//! actuellement appliquée est stockée dans le compteur natif SQLite
//! `PRAGMA user_version` : pas besoin de table ni de dépendance externe pour
//! cela.
//!
//! Pour ajouter une évolution de schéma dans une étape future :
//!   1. Ajouter un fichier `000N_xxx.sql` dans ce dossier ;
//!   2. Ajouter une entrée correspondante dans `MIGRATIONS` ci-dessous ;
//!   3. Ne jamais modifier une migration déjà publiée dans une version
//!      livrée du logiciel — seulement en ajouter de nouvelles.
//!
//! Ces migrations ne modifient que le schéma (DDL). Les données par défaut
//! (ex. profil "Administrateur") sont insérées séparément par `db::seed`,
//! après application des migrations, pour rester idempotentes et ne jamais
//! écraser des données existantes lors d'une mise à jour.

use super::DbPool;

/// Une migration de schéma versionnée.
pub struct Migration {
    /// Numéro de version cible après application (doit être strictement
    /// croissant et sans trou dans l'ordre de la liste `MIGRATIONS`).
    pub version: i32,
    /// Description humaine, utilisée uniquement dans les logs.
    pub description: &'static str,
    /// Contenu SQL exécuté en une seule fois (`execute_batch`).
    pub sql: &'static str,
}

/// Liste ordonnée de toutes les migrations connues de l'application.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        description: "Création de la table profiles",
        sql: include_str!("0001_initial.sql"),
    },
    Migration {
        version: 2,
        description: "Création des bibliothèques, dossiers et fichiers médias",
        sql: include_str!("0002_libraries.sql"),
    },
    Migration {
        version: 3,
        description: "Création de la table de progression de lecture",
        sql: include_str!("0003_playback_progress.sql"),
    },
    Migration {
        version: 4,
        description: "Catégories et modèle de contenu (Titre/Saison/Épisode)",
        sql: include_str!("0004_categories_and_titles.sql"),
    },
    Migration {
        version: 5,
        description: "Fondation isolée de la section privée (sans authentification — Étape 6)",
        sql: include_str!("0005_private_libraries.sql"),
    },
    Migration {
        version: 6,
        description: "Personnalisation générique (custom_images), remplace les colonnes custom_*_path",
        sql: include_str!("0006_custom_images.sql"),
    },
    Migration {
        version: 7,
        description: "Scoping de playback_progress par profil (Étape 6a)",
        sql: include_str!("0007_playback_progress_profile_scope.sql"),
    },
    Migration {
        version: 8,
        description: "Permissions de profil explicites (Étape 6a)",
        sql: include_str!("0008_profile_permissions.sql"),
    },
    Migration {
        version: 9,
        description: "Configuration du coffre privé (sel Argon2id, Étape 6a)",
        sql: include_str!("0009_vault_security.sql"),
    },
    Migration {
        version: 10,
        description: "Suppression de l'ancienne table private_libraries (déplacée vers vault.db)",
        sql: include_str!("0010_drop_legacy_private_libraries.sql"),
    },
    Migration {
        version: 11,
        description: "Mémorisation de la position/taille de la fenêtre détachée du lecteur",
        sql: include_str!("0011_player_window_state.sql"),
    },
    Migration {
        version: 12,
        description: "Persistance des réglages du lecteur (volume, muet, vitesse)",
        sql: include_str!("0012_player_settings.sql"),
    },
	Migration {
    version: 13,
    description: "Authentification des profils (mot de passe + code de récupération, Étape 6c)",
    sql: include_str!("0013_profile_auth.sql"),
},
        Migration {
        version: 14,
        description: "Métadonnées TMDB et paramètres applicatifs (Étape 7)",
        sql: include_str!("0014_tmdb_and_settings.sql"),
    },
	    Migration {
        version: 15,
        description: "Sonde technique des fichiers média (résolution, codec vidéo, langues audio/sous-titres) pour l'Explorateur — Étape 7",
        sql: include_str!("0015_technical_probe.sql"),
    },
	    Migration {
        version: 16,
        description: "Collections utilisateur (Étape 8)",
        sql: include_str!("0016_collections.sql"),
    },
	    Migration {
        version: 17,
        description: "Historique de visionnage (Time Capsule, Étape 8)",
        sql: include_str!("0017_watch_history.sql"),
    },
];

/// Applique, dans l'ordre, toutes les migrations dont la version est
/// supérieure à la version actuellement stockée dans `PRAGMA user_version`.
///
/// Sur une base vide, `user_version` vaut `0` par défaut (comportement natif
/// SQLite) : toutes les migrations sont donc appliquées au premier lancement.
/// Sur une base existante après une mise à jour du logiciel, seules les
/// migrations nouvelles (version > version stockée) sont exécutées, ce qui
/// permet de faire évoluer le schéma sans perdre les données déjà présentes.
pub fn apply_migrations(pool: &DbPool) -> Result<(), Box<dyn std::error::Error>> {
    let conn = pool.get()?;

    let current_version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    let mut applied = 0;
    for migration in MIGRATIONS.iter().filter(|m| m.version > current_version) {
        log::info!(
            "Application de la migration {} — {}",
            migration.version,
            migration.description
        );
        conn.execute_batch(migration.sql)?;
        conn.pragma_update(None, "user_version", migration.version)?;
        applied += 1;
    }

    if applied == 0 {
        log::info!(
            "Base de données déjà à jour (version {}).",
            current_version
        );
    }

    Ok(())
}
