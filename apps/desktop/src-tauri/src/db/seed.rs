//! Insertion des données par défaut, séparée des migrations de schéma.
//!
//! Chaque fonction ici doit être idempotente (sans effet si les données
//! existent déjà), pour pouvoir être rejouée sans risque à chaque démarrage
//! de l'application, y compris après une mise à jour.

use super::repositories::{category_repository, library_repository, profile_repository};
use super::DbPool;

/// Crée le profil "Administrateur" par défaut si aucun profil n'existe
/// encore.
///
/// Depuis l'Étape 6a (doc §6.5), ce profil reçoit directement toutes les
/// permissions (`can_access_private`, `can_manage_global_settings`,
/// `can_manage_profiles` — colonnes ajoutées par la migration 0008) : sur
/// une installation neuve, cette fonction s'exécute après les migrations
/// mais avant toute autre donnée, donc avant que le backfill de la
/// migration 0008 (qui ne rattrape que des profils déjà existants lors
/// d'une mise à jour) ait pu s'appliquer — c'est ici, et seulement ici,
/// qu'il faut les poser explicitement pour un nouveau profil.
pub fn ensure_default_profile(pool: &DbPool) -> Result<(), Box<dyn std::error::Error>> {
    let conn = pool.get()?;

    let profile_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0))?;

    if profile_count == 0 {
        profile_repository::create(&conn, "Administrateur", "admin", true, true, true)?;
        log::info!("Profil par défaut 'Administrateur' créé.");
    }

    Ok(())
}

/// Les 5 catégories système de la doc §6.1, dans l'ordre d'affichage par
/// défaut. `key` est la clé stable utilisée par le reste du code (routage
/// frontend, bascule des anciennes bibliothèques ci-dessous) — jamais
/// affichée telle quelle, `name` porte le libellé visible.
const SYSTEM_CATEGORIES: &[(&str, &str, &str)] = &[
    ("movies", "Films", "🎬"),
    ("series", "Séries", "📺"),
    ("anime", "Anime", "🌸"),
    ("documentaries", "Documentaires", "🎥"),
    ("private", "Privé", "🔒"),
];

/// Crée les 5 catégories système si elles n'existent pas encore
/// (`category_repository::ensure` est déjà idempotente par `key`). Doit
/// s'exécuter avant `backfill_library_categories`, qui a besoin qu'elles
/// existent déjà pour pouvoir y rattacher les bibliothèques existantes.
pub fn ensure_default_categories(pool: &DbPool) -> Result<(), Box<dyn std::error::Error>> {
    let conn = pool.get()?;

    for (index, (key, name, icon)) in SYSTEM_CATEGORIES.iter().enumerate() {
        category_repository::ensure(&conn, key, name, Some(icon), index as i64, true)?;
    }

    Ok(())
}

/// Bascule les bibliothèques créées avant l'Étape 4 (`category_id` encore
/// `NULL`, rattachées uniquement par l'ancien `media_type` texte libre —
/// migration 0002) vers la nouvelle Catégorie correspondante.
///
/// Correspondance : les 4 anciens presets alignés avec une catégorie
/// système (`movies`, `series`, `anime`, `documentaries`) basculent
/// directement. `personal_videos` et `other` n'ont pas d'équivalent
/// propre : l'ancien concept "Vidéos personnelles" n'était qu'une
/// bibliothèque comme une autre, jamais le vrai coffre isolé que décrit
/// désormais la doc §6.4 (table `private_libraries`, hors de `libraries`)
/// — les faire basculer vers la Catégorie Privé mélangerait deux modèles
/// de données différents. Ces deux cas basculent donc vers `movies` par
/// défaut (visible et corrigible manuellement par l'utilisateur), plutôt
/// que de construire une migration de données inter-tables pour un cas
/// qui, en pratique, ne concerne aucune installation existante à ce stade
/// du projet.
fn category_key_for_legacy_media_type(media_type: &str) -> &'static str {
    match media_type {
        "movies" => "movies",
        "series" => "series",
        "anime" => "anime",
        "documentaries" => "documentaries",
        _ => "movies",
    }
}

pub fn backfill_library_categories(pool: &DbPool) -> Result<(), Box<dyn std::error::Error>> {
    let conn = pool.get()?;

    let pending = library_repository::list_without_category(&conn)?;
    if pending.is_empty() {
        return Ok(());
    }

    for (library_id, media_type) in pending {
        let key = category_key_for_legacy_media_type(&media_type);
        if let Some(category) = category_repository::get_by_key(&conn, key)? {
            library_repository::set_category(&conn, library_id, category.id)?;
            log::info!(
                "Bibliothèque {library_id} (ancien media_type '{media_type}') rattachée à la catégorie '{key}'."
            );
        }
    }

    Ok(())
}
