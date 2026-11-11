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
    Migration {
        version: 18,
        description: "AetherFy — colonne source multi-plateformes (jalon 3)",
        sql: include_str!("0018_aetherfy.sql"),
    },
    Migration {
        version: 19,
        description: "AetherFy — colonne source pour les items des playlists locales (jalon 3)",
        sql: include_str!("0019_aetherfy_playlist_source.sql"),
    },
    Migration {
        version: 20,
        description: "AetherFy — mode de lecture (video/audio) pour playlists et abonnements (jalon 3)",
        sql: include_str!("0020_aetherfy_modes.sql"),
    },
    Migration {
        version: 21,
        description: "AetherFy — colonne mode sur vaulttube_videos (complément migration 20)",
        sql: include_str!("0021_aetherfy_videos_mode.sql"),
    },
    Migration {
        version: 22,
        description: "Système d'amis et activité de visionnage",
        sql: include_str!("0022_friends_and_activity.sql"),
    },
    Migration {
        version: 23,
        description: "Amis distants (remote friends)",
        sql: include_str!("0023_remote_friends.sql"),
    },
    Migration {
        version: 24,
        description: "AetherFy — colonne is_short sur vaulttube_videos (détection Shorts fiable)",
        sql: include_str!("0024_aetherfy_shorts.sql"),
    },
	    Migration {
        version: 25,
        description: "Catégorie TV — table tv_channels (flux IPTV/HLS publics)",
        sql: include_str!("0025_tv_channels.sql"),
    },
    Migration {
        version: 26,
        description: "Notes personnelles (demi-étoiles) et Watchlist, par profil",
        sql: include_str!("0026_ratings_watchlist.sql"),
    },
    Migration {
        version: 27,
        description: "Sagas (TMDB belongs_to_collection) pour les Collections intelligentes",
        sql: include_str!("0027_sagas.sql"),
    },
    Migration {
        version: 28,
        description: "Statuts de visionnage automatiques (À voir / En cours / Vu), par profil et par média",
        sql: include_str!("0028_media_watch_status.sql"),
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
        run_migration(&conn, migration.sql)?;
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

// ---- Exécution tolérante aux colonnes déjà présentes (0.7.9) ------------------
//
// Les tables VaultTube sont créées HORS migrations par `VaultTubeRepository::
// create_tables()` — avant elles, car les migrations 18 à 24 les modifient — et
// avec leur schéma FINAL (colonnes `source`, `mode`, `is_short` comprises). Sur
// une base neuve, ces migrations (de simples `ALTER TABLE … ADD COLUMN`) tentaient
// donc d'ajouter des colonnes déjà là : « duplicate column name: source » et
// l'application ne démarrait pas. Même cas pour une base laissée à moitié
// initialisée par un démarrage raté de ce type.
//
// SQLite n'a pas de `ADD COLUMN IF NOT EXISTS` : si le lot échoue pour cette seule
// raison, on le rejoue instruction par instruction en ignorant uniquement cette
// erreur-là. Toute autre erreur reste fatale.

fn is_duplicate_column(error: &rusqlite::Error) -> bool {
    error.to_string().contains("duplicate column name")
}

/// Découpe un script SQL en instructions (point-virgule hors apostrophes ;
/// commentaires `-- …` ignorés). Suffisant pour les migrations qui n'ont que des
/// instructions simples ; ne gère pas les déclencheurs `BEGIN … END`.
fn split_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                in_quote = !in_quote;
                current.push(c);
            }
            '-' if !in_quote && chars.peek() == Some(&'-') => {
                while let Some(&next) = chars.peek() {
                    if next == '\n' {
                        break;
                    }
                    chars.next();
                }
            }
            ';' if !in_quote => {
                let statement = current.trim();
                if !statement.is_empty() {
                    statements.push(statement.to_string());
                }
                current.clear();
            }
            _ => current.push(c),
        }
    }
    let rest = current.trim();
    if !rest.is_empty() {
        statements.push(rest.to_string());
    }
    statements
}

fn run_migration(conn: &rusqlite::Connection, sql: &str) -> rusqlite::Result<()> {
    match conn.execute_batch(sql) {
        Err(error) if is_duplicate_column(&error) => {
            log::warn!("Colonne déjà présente : la migration est rejouée instruction par instruction.");
            for statement in split_statements(sql) {
                match conn.execute_batch(&statement) {
                    Err(e) if is_duplicate_column(&e) => {
                        log::info!("Instruction ignorée (colonne déjà présente) : {statement}");
                    }
                    other => other?,
                }
            }
            Ok(())
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn decoupe_les_instructions_et_ignore_les_commentaires() {
        let sql = "-- en-tête ; avec point-virgule\nALTER TABLE a ADD COLUMN x TEXT DEFAULT 'a;b';\n\
                   ALTER TABLE a ADD COLUMN y INTEGER; -- fin\n\n";
        assert_eq!(
            split_statements(sql),
            vec![
                "ALTER TABLE a ADD COLUMN x TEXT DEFAULT 'a;b'".to_string(),
                "ALTER TABLE a ADD COLUMN y INTEGER".to_string(),
            ]
        );
        assert!(split_statements("  \n-- rien\n").is_empty());
    }

    #[test]
    fn colonne_deja_presente_est_ignoree_les_autres_sont_ajoutees() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY, source TEXT);").unwrap();
        // `source` existe déjà (schéma final créé hors migrations), `mode` non.
        run_migration(
            &conn,
            "ALTER TABLE t ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube';\n\
             ALTER TABLE t ADD COLUMN mode TEXT NOT NULL DEFAULT 'video';",
        )
        .expect("une colonne déjà présente ne doit pas bloquer la migration");
        let columns: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('t')")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(columns.contains(&"mode".to_string()), "colonne manquante ajoutée : {columns:?}");
    }

    #[test]
    fn les_autres_erreurs_restent_fatales() {
        let conn = Connection::open_in_memory().unwrap();
        assert!(run_migration(&conn, "ALTER TABLE inexistante ADD COLUMN x TEXT;").is_err());
        // Même après une colonne en double, une vraie erreur plus loin n'est pas masquée.
        conn.execute_batch("CREATE TABLE t (source TEXT);").unwrap();
        let result = run_migration(
            &conn,
            "ALTER TABLE t ADD COLUMN source TEXT;\nALTER TABLE inexistante ADD COLUMN x TEXT;",
        );
        assert!(result.is_err());
    }
}
