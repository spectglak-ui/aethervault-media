//! Accès à la base de données locale (SQLite).
//!
//! Ce module expose :
//! - le type de pool `DbPool`, partagé via l'état Tauri ;
//! - `init_pool`, qui ouvre/creé le fichier `.db` ;
//! - le sous-module `migrations`, qui fait évoluer le schéma de façon
//!   versionnée et compatible avec les mises à jour futures ;
//! - le sous-module `seed`, qui insère les données par défaut après
//!   migration.
//!
//! Aucune requête SQL ne doit être écrite en dehors de ce module (et de ses
//! sous-modules) : les futurs modules `domain`/`services` passeront par des
//! fonctions dédiées ici plutôt que par du SQL dispersé dans le reste du
//! code.

pub mod migrations;
pub mod repositories;
pub mod seed;

use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;

/// Pool de connexions SQLite partagé entre les commandes Tauri.
///
/// Un pool (plutôt qu'une connexion unique protégée par un mutex) est utilisé
/// car Tauri peut exécuter les commandes sur plusieurs threads ; `r2d2` gère
/// cette concurrence de façon standard et éprouvée.
pub type DbPool = r2d2::Pool<SqliteConnectionManager>;

/// Initialise le pool de connexions vers le fichier SQLite de l'application.
///
/// Le driver `rusqlite` est utilisé avec la fonctionnalité `bundled`, qui
/// compile SQLite directement dans le binaire : cela évite de dépendre d'une
/// DLL SQLite installée séparément sur la machine de l'utilisateur, ce qui
/// est important pour un installateur Windows simple et autonome.
///
/// `PRAGMA foreign_keys` est un réglage *par connexion* (pas persisté dans
/// le fichier `.db` comme `user_version`) : `with_init` l'applique donc à
/// chaque nouvelle connexion ouverte par le pool, pour que les
/// `ON DELETE CASCADE` des tables de bibliothèques fonctionnent réellement.
///
/// `PRAGMA busy_timeout` fait attendre SQLite (au lieu d'échouer
/// immédiatement) si une autre connexion du pool détient un verrou
/// d'écriture au même instant — situation qui devient possible dès l'Étape
/// 2b, où un scan manuel et le traitement des événements du Filesystem
/// Watcher peuvent, en théorie, écrire en même temps.
pub fn init_pool(database_path: &Path) -> Result<DbPool, Box<dyn std::error::Error>> {
    let manager = SqliteConnectionManager::file(database_path).with_init(|conn| {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
    });
    let pool = r2d2::Pool::builder().build(manager)?;
    Ok(pool)
}
