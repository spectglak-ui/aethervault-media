//! Vue des Catégories exposée au frontend (doc §6.1) — combine
//! `category_repository` avec la règle métier "jamais de compteur pour
//! Privé" (doc §6.4), qui ne relève pas du repository (une simple requête
//! SQL n'a aucune raison de connaître cette règle de confidentialité).

use crate::db::repositories::{category_repository, custom_image_repository};
use crate::db::DbPool;
use serde::Serialize;

/// Clé stable de la catégorie Privé — la seule dont le nombre de Titres
/// n'est jamais exposé, même à zéro (doc §6.4 : "aucune information sur le
/// contenu" avant authentification, qui n'existe pas encore avant l'Étape
/// 6 — en attendant, la prudence est de ne jamais rien afficher plutôt que
/// d'afficher un compteur à 0 qui deviendrait trompeur dès que l'Étape 6
/// ajoutera du contenu réel derrière).
const PRIVATE_CATEGORY_KEY: &str = "private";

/// Type d'entité utilisé comme clé dans `custom_images` (doc §6.6) —
/// constante plutôt que chaîne répétée à chaque appel, pour qu'une faute
/// de frappe soit une erreur de compilation plutôt qu'un bug silencieux.
const ENTITY_TYPE: &str = "category";
const BANNER_PURPOSE: &str = "banner";

#[derive(Debug, Clone, Serialize)]
pub struct CategorySummary {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub icon: Option<String>,
    /// Bannière *effective* : l'image personnalisée par l'utilisateur si
    /// elle existe, sinon celle du Metadata Service — jamais les deux
    /// exposées séparément au frontend, qui n'a pas besoin de connaître la
    /// provenance pour un simple affichage (doc §6.6).
    pub banner: Option<String>,
    /// `true` si `banner` provient d'une personnalisation utilisateur —
    /// commande l'affichage du bouton "Réinitialiser" côté frontend
    /// (`PersonalizableImage`), qui n'a pas de sens face à une image déjà
    /// automatique.
    pub banner_is_custom: bool,
    pub sort_order: i64,
    pub is_system: bool,
    /// `None` pour la catégorie Privé, toujours — voir `PRIVATE_CATEGORY_KEY`
    /// ci-dessus. `Some(0)` est une valeur légitime pour les 4 autres
    /// catégories (aucun Titre apparié pour l'instant).
    pub title_count: Option<i64>,
}

pub fn list_categories(pool: &DbPool) -> Result<Vec<CategorySummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let records = category_repository::list_all(&conn).map_err(|e| e.to_string())?;

    let mut summaries = Vec::with_capacity(records.len());
    for record in records {
        let title_count = if record.key == PRIVATE_CATEGORY_KEY {
            None
        } else {
            Some(category_repository::count_titles(&conn, record.id).map_err(|e| e.to_string())?)
        };

        let custom_banner =
            custom_image_repository::get(&conn, ENTITY_TYPE, record.id, BANNER_PURPOSE)
                .map_err(|e| e.to_string())?;

        summaries.push(CategorySummary {
            id: record.id,
            key: record.key,
            name: record.name,
            icon: record.icon,
            banner_is_custom: custom_banner.is_some(),
            banner: custom_banner.or(record.banner_path),
            sort_order: record.sort_order,
            is_system: record.is_system,
            title_count,
        });
    }

    Ok(summaries)
}

/// `path` à `None` efface la personnalisation (retour à la bannière
/// automatique, si elle existe).
pub fn set_custom_banner(pool: &DbPool, category_id: i64, path: Option<&str>) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    custom_image_repository::set(&conn, ENTITY_TYPE, category_id, BANNER_PURPOSE, path)
        .map_err(|e| e.to_string())
}
