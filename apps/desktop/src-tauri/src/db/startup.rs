//! Préparation de la base de données au démarrage (0.7.9).
//!
//! UNE seule séquence, appelée par `run()` (voir `lib.rs`) ET par les tests, sur
//! une base neuve comme sur une base existante. Elle a été extraite de `setup`
//! après un défaut réel : la catégorie système « Lecture » (0.7.0) était créée
//! AVANT les migrations, or elle a besoin de la table `categories` (migration 4).
//! Sur une base neuve — première installation, nouveau profil Windows — le
//! démarrage plantait donc, sans aucun message (application sans console).
//! Les développeurs, eux, ont toujours une base déjà migrée : le défaut passait
//! inaperçu.
//!
//! Ordre (chaque étape dépend des précédentes) :
//! 1. tables créées HORS migrations mais modifiées par elles (VaultTube,
//!    migrations 18 à 24) → avant les migrations ;
//! 2. tables de la catégorie Lecture (aucune migration n'y touche) ;
//! 3. migrations versionnées ;
//! 4. données par défaut (profil, catégories) ;
//! 5. catégorie système « Lecture » — après les catégories par défaut, pour se
//!    ranger à leur suite (même rang que sur une base mise à jour) ;
//! 6. rattachement des bibliothèques existantes à leur catégorie.

use std::error::Error;

use super::{migrations, repositories::reading_repository, seed, DbPool};
use crate::services::vaulttube::VaultTubeRepository;

/// Ajoute le nom de l'étape à l'erreur : « migrations : … » est exploitable,
/// « no such table » seul ne dit pas où chercher.
fn step<T, E: std::fmt::Display>(name: &str, result: Result<T, E>) -> Result<T, Box<dyn Error>> {
    result.map_err(|e| format!("{name} : {e}").into())
}

pub fn prepare_database(pool: &DbPool) -> Result<(), Box<dyn Error>> {
    step(
        "création des tables VaultTube",
        VaultTubeRepository::new(pool.clone()).create_tables(),
    )?;
    {
        let conn = step("connexion à la base", pool.get())?;
        step("création des tables Lecture", reading_repository::ensure_tables(&conn))?;
    }
    step("migrations", migrations::apply_migrations(pool))?;
    step("profil par défaut", seed::ensure_default_profile(pool))?;
    step("catégories par défaut", seed::ensure_default_categories(pool))?;
    {
        let conn = step("connexion à la base", pool.get())?;
        step("catégorie Lecture", reading_repository::ensure_category(&conn))?;
    }
    step(
        "rattachement des bibliothèques aux catégories",
        seed::backfill_library_categories(pool),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_pool;

    struct TempDb {
        dir: std::path::PathBuf,
        pool: DbPool,
    }

    impl TempDb {
        fn new(name: &str) -> TempDb {
            let dir = std::env::temp_dir().join(format!("avm-startup-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let pool = init_pool(&dir.join("aethervault.db")).expect("init_pool");
            TempDb { dir, pool }
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn categories(pool: &DbPool) -> Vec<(String, i64)> {
        let conn = pool.get().unwrap();
        let mut stmt = conn
            .prepare("SELECT key, sort_order FROM categories ORDER BY sort_order, id")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    /// Le défaut d'origine : première installation (base NEUVE).
    #[test]
    fn une_base_neuve_demarre_sans_erreur() {
        let db = TempDb::new("neuve");
        prepare_database(&db.pool).expect("le premier démarrage doit réussir");
        let keys: Vec<String> = categories(&db.pool).into_iter().map(|(k, _)| k).collect();
        assert!(keys.contains(&"reading".to_string()), "catégorie Lecture absente : {keys:?}");
        assert!(keys.len() > 1, "catégories par défaut absentes : {keys:?}");
    }

    #[test]
    fn un_second_demarrage_ne_change_rien() {
        let db = TempDb::new("rejeu");
        prepare_database(&db.pool).unwrap();
        let first = categories(&db.pool);
        prepare_database(&db.pool).expect("le second démarrage doit réussir");
        assert_eq!(categories(&db.pool), first);
    }

    #[test]
    fn la_categorie_lecture_suit_les_categories_par_defaut() {
        let db = TempDb::new("ordre");
        prepare_database(&db.pool).unwrap();
        let cats = categories(&db.pool);
        let (last_key, last_order) = cats.last().unwrap().clone();
        assert_eq!(last_key, "reading", "Lecture doit être la dernière : {cats:?}");
        let others_max = cats.iter().filter(|(k, _)| k != "reading").map(|(_, o)| *o).max().unwrap();
        assert!(last_order > others_max, "rang de Lecture non distinct : {cats:?}");
    }

    /// Base laissée à moitié initialisée par l'ancien défaut : tables VaultTube au
    /// schéma final (créées hors migrations) + migrations 1 à 17 seulement.
    #[test]
    fn une_base_a_moitie_initialisee_est_reparee() {
        let db = TempDb::new("moitie");
        VaultTubeRepository::new(db.pool.clone()).create_tables().unwrap();
        {
            let conn = db.pool.get().unwrap();
            for m in migrations::MIGRATIONS.iter().filter(|m| m.version <= 17) {
                conn.execute_batch(m.sql).unwrap();
                conn.pragma_update(None, "user_version", m.version).unwrap();
            }
        }
        prepare_database(&db.pool).expect("la base à moitié initialisée doit être réparée");
        let version: i32 = db
            .pool
            .get()
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, migrations::MIGRATIONS.last().unwrap().version);
    }

    /// Mise à jour d'une base existante à laquelle manque la catégorie Lecture.
    #[test]
    fn une_base_existante_sans_lecture_la_recoit_une_seule_fois() {
        let db = TempDb::new("miseajour");
        prepare_database(&db.pool).unwrap();
        db.pool
            .get()
            .unwrap()
            .execute("DELETE FROM categories WHERE key = 'reading'", [])
            .unwrap();
        prepare_database(&db.pool).unwrap();
        prepare_database(&db.pool).unwrap();
        let n = categories(&db.pool).iter().filter(|(k, _)| k == "reading").count();
        assert_eq!(n, 1);
    }
}
