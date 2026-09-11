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

/// Explorateur (Étape 7, lot 3) : recherche multicritère + facets.
#[tauri::command]
pub fn search_titles(
    state: tauri::State<AppState>,
    query: crate::db::repositories::title_repository::TitleSearchQuery,
) -> Result<Vec<crate::db::repositories::title_repository::TitleSearchResult>, String> {
    title::search_titles(&state.db_pool, query)
}

#[tauri::command]
pub fn search_facets(state: tauri::State<AppState>) -> Result<title::SearchFacets, String> {
    title::search_facets(&state.db_pool)
}

/// Accueil v2 (Étape 7) : rangée « Ajouts récents ».
#[tauri::command]
pub fn list_recent_titles(state: tauri::State<AppState>) -> Result<Vec<TitleSummary>, String> {
    title::list_recent_titles(&state.db_pool, 20)
}

/// Accueil v2 (Étape 7) : héro « à la une » (aléatoire parmi les Titres
/// ayant un backdrop), `null` si aucun Titre enrichi pour l'instant.
#[tauri::command]
pub fn get_home_hero(state: tauri::State<AppState>) -> Result<Option<TitleDetails>, String> {
    title::home_hero(&state.db_pool)
}

// ---- Collections utilisateur (Étape 8) -------------------------------
#[tauri::command]
pub fn create_collection(state: tauri::State<AppState>, name: String) -> Result<i64, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Le nom de la collection ne peut pas être vide.".to_string());
    }
    let conn = state.get_conn()?;
    crate::db::repositories::title_repository::create_collection(&conn, trimmed)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collections(
    state: tauri::State<AppState>,
) -> Result<Vec<crate::db::repositories::title_repository::CollectionRecord>, String> {
    let conn = state.get_conn()?;
    crate::db::repositories::title_repository::list_collections(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_collection(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::repositories::title_repository::delete_collection(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_to_collection(
    state: tauri::State<AppState>,
    collection_id: i64,
    title_id: i64,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::repositories::title_repository::add_to_collection(&conn, collection_id, title_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_from_collection(
    state: tauri::State<AppState>,
    collection_id: i64,
    title_id: i64,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::repositories::title_repository::remove_from_collection(&conn, collection_id, title_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collections_for_title(
    state: tauri::State<AppState>,
    title_id: i64,
) -> Result<Vec<i64>, String> {
    let conn = state.get_conn()?;
    crate::db::repositories::title_repository::list_collections_for_title(&conn, title_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collection_titles(
    state: tauri::State<AppState>,
    collection_id: i64,
) -> Result<Vec<TitleSummary>, String> {
    let conn = state.get_conn()?;
    let rows =
        crate::db::repositories::title_repository::list_collection_titles(&conn, collection_id)
            .map_err(|e| e.to_string())?;
    let mut summaries = Vec::with_capacity(rows.len());
    for (id, category_id, kind, name, year, poster_path) in rows {
        let custom_poster =
            crate::db::repositories::custom_image_repository::get(&conn, "title", id, "poster")
                .map_err(|e| e.to_string())?;
        summaries.push(TitleSummary {
            id,
            category_id,
            kind,
            name,
            year,
            poster: custom_poster.or(poster_path),
        });
    }
    Ok(summaries)
}

/// 0.6.0 : acteurs d'un Titre (crédits TMDB, photos locales).
#[tauri::command]
pub fn get_title_cast(
    state: tauri::State<AppState>,
    title_id: i64,
) -> Result<Vec<crate::services::metadata::tmdb::TmdbCreditPerson>, String> {
    let conn = state.get_conn()?;
    let (tmdb_id, kind) = crate::db::repositories::title_repository::get_tmdb_id(&conn, title_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Titre sans identifiant TMDB (scan/enrichissement incomplet)".to_string())?;
    let settings = crate::services::metadata::tmdb::load_settings(&conn);
    if settings.api_key.is_empty() {
        return Ok(Vec::new());
    }
    let client = crate::services::metadata::tmdb::TmdbClient {
        api_key: settings.api_key,
        lang: settings.language,
    };
    Ok(client.fetch_title_cast(&kind, tmdb_id, &state.data_dir))
}

/// 0.6.0 : fiche personne TMDB.
#[tauri::command]
pub fn get_person(
    state: tauri::State<AppState>,
    person_id: i64,
) -> Result<crate::services::metadata::tmdb::TmdbPerson, String> {
    let conn = state.get_conn()?;
    let settings = crate::services::metadata::tmdb::load_settings(&conn);
    if settings.api_key.is_empty() {
        return Err("Clé API TMDB absente".to_string());
    }
    let client = crate::services::metadata::tmdb::TmdbClient {
        api_key: settings.api_key,
        lang: settings.language,
    };
    client
        .fetch_person(person_id, &state.data_dir)
        .ok_or_else(|| "Personne introuvable sur TMDB".to_string())
}

/// 0.6.0 : titres POSSÉDÉS dans lesquels la personne apparaît.
#[tauri::command]
pub fn list_person_titles(
    state: tauri::State<AppState>,
    person_id: i64,
) -> Result<Vec<TitleSummary>, String> {
    let conn = state.get_conn()?;
    let settings = crate::services::metadata::tmdb::load_settings(&conn);
    if settings.api_key.is_empty() {
        return Ok(Vec::new());
    }
    let client = crate::services::metadata::tmdb::TmdbClient {
        api_key: settings.api_key,
        lang: settings.language,
    };
    let credits = client.fetch_person_credits(person_id);
    let movie_ids: Vec<i64> = credits
        .iter()
        .filter(|(_, m)| m == "movie")
        .map(|(id, _)| *id)
        .collect();
    let tv_ids: Vec<i64> = credits
        .iter()
        .filter(|(_, m)| m != "movie")
        .map(|(id, _)| *id)
        .collect();
    let mut summaries = Vec::new();
    for (kind, ids) in [("movie", &movie_ids), ("series", &tv_ids)] {
        let rows = crate::db::repositories::title_repository::list_titles_by_tmdb_ids(
            &conn, kind, ids,
        )
        .map_err(|e| e.to_string())?;
        for (id, category_id, k, name, year, poster_path) in rows {
            let custom =
                crate::db::repositories::custom_image_repository::get(&conn, "title", id, "poster")
                    .map_err(|e| e.to_string())?;
            summaries.push(TitleSummary {
    id,
    category_id,
    kind: k,
    name,
    year: year.map(|y| y as i64), // Conversion explicite de i32 vers i64
    poster: custom.or(poster_path),
});
        }
    }
    Ok(summaries)
}