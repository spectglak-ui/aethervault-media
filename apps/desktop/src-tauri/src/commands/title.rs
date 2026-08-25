//! Commandes de navigation dans le contenu (Titre/Saison/Épisode, doc
//! §6.3) : de simples wrappers autour de `domain::title` — aucune règle
//! métier ni SQL direct ici.

use crate::domain::title::{self, EpisodeSummary, TitleDetails, TitleSummary};
use crate::services::image_store;
use crate::state::AppState;

#[tauri::command]
pub fn list_titles_by_category(
    state: tauri::State<AppState>,
    category_id: i64,
) -> Result<Vec<TitleSummary>, String> {
    title::list_titles_by_category(&state.db_pool, category_id)
}

#[tauri::command]
pub fn get_title_details(state: tauri::State<AppState>, title_id: i64) -> Result<TitleDetails, String> {
    title::get_title_details(&state.db_pool, title_id)
}

#[tauri::command]
pub fn list_episodes(state: tauri::State<AppState>, season_id: i64) -> Result<Vec<EpisodeSummary>, String> {
    title::list_episodes(&state.db_pool, season_id)
}

/// `source_path` à `None` efface la personnalisation (retour à l'affiche
/// automatique du Metadata Service, si elle existe).
#[tauri::command]
pub fn set_title_poster(
    state: tauri::State<AppState>,
    title_id: i64,
    source_path: Option<String>,
) -> Result<(), String> {
    let path = match source_path {
        Some(source) => Some(image_store::store_custom_image(
            std::path::Path::new(&state.data_dir),
            "titles",
            title_id,
            "poster",
            &source,
        )?),
        None => None,
    };

    title::set_custom_poster(&state.db_pool, title_id, path.as_deref())
}

#[tauri::command]
pub fn set_title_banner(
    state: tauri::State<AppState>,
    title_id: i64,
    source_path: Option<String>,
) -> Result<(), String> {
    let path = match source_path {
        Some(source) => Some(image_store::store_custom_image(
            std::path::Path::new(&state.data_dir),
            "titles",
            title_id,
            "banner",
            &source,
        )?),
        None => None,
    };

    title::set_custom_banner(&state.db_pool, title_id, path.as_deref())
}

/// Suppression manuelle d'un Titre depuis sa carte (grille de Catégorie).
/// Ne touche jamais aux fichiers média sur le disque — voir
/// `domain::title::delete_title`.
#[tauri::command]
pub fn delete_title(state: tauri::State<AppState>, title_id: i64) -> Result<(), String> {
    title::delete_title(&state.db_pool, title_id)
}
