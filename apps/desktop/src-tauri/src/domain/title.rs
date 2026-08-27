//! Vue du contenu (Titre/Saison/Épisode) exposée au frontend — doc §6.3.
//!
//! Assemble plusieurs repositories (`title_repository`, `season_repository`,
//! `episode_repository`, `media_repository`, `custom_image_repository`,
//! `media_probe_repository`) en une seule réponse par écran, pour que le
//! frontend n'ait jamais à enchaîner plusieurs commandes pour afficher une
//! seule page.
use crate::db::repositories::{
    custom_image_repository, episode_repository, media_probe_repository, media_repository,
    season_repository, title_repository,
};
use crate::db::DbPool;
use crate::services::image_store;
use serde::Serialize;

/// Type d'entité utilisé comme clé dans `custom_images` (doc §6.6) — voir
/// `domain::category::ENTITY_TYPE` pour la même convention côté Catégorie.
const ENTITY_TYPE: &str = "title";
const POSTER_PURPOSE: &str = "poster";
const BANNER_PURPOSE: &str = "banner";

#[derive(Debug, Clone, Serialize)]
pub struct TitleSummary {
    pub id: i64,
    pub category_id: i64,
    pub kind: String,
    pub name: String,
    pub year: Option<i64>,
    /// Affiche effective (personnalisée si elle existe, sinon celle du
    /// Metadata Service) — même logique que `CategorySummary::banner`.
    pub poster: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TitleCredit {
    pub name: String,
    pub character_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SeasonSummary {
    pub id: i64,
    pub season_number: i64,
    pub name: Option<String>,
    pub episode_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EpisodeSummary {
    pub id: i64,
    pub episode_number: i64,
    pub name: Option<String>,
    pub description: Option<String>,
    pub duration_seconds: Option<i64>,
    pub still: Option<String>,
    pub media_file_id: Option<i64>,
    /// Résolution du fichier média associé (si sondé) — `None` sinon.
    /// Alimente le badge technique sur la liste des épisodes (Étape 7, lot 4).
    pub resolution: Option<String>,
}

/// Informations techniques agrégées depuis tous les fichiers média
/// rattachés à un Titre (Étape 7, lot 4) : résolution, codec vidéo,
/// langues audio et sous-titres distincts, triés.
#[derive(Debug, Clone, Serialize)]
pub struct TechnicalInfo {
    pub resolutions: Vec<String>,
    pub codecs: Vec<String>,
    pub audio_langs: Vec<String>,
    pub subtitle_langs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TitleDetails {
    pub id: i64,
    pub category_id: i64,
    pub kind: String,
    pub name: String,
    pub description: Option<String>,
    pub year: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub poster: Option<String>,
    /// `true` si `poster` provient d'une personnalisation utilisateur —
    /// voir `CategorySummary::banner_is_custom` pour la même convention.
    pub poster_is_custom: bool,
    pub banner: Option<String>,
    pub banner_is_custom: bool,
    pub rating: Option<f64>,
    pub genres: Vec<String>,
    pub studios: Vec<String>,
    pub cast: Vec<TitleCredit>,
    pub directors: Vec<String>,
    /// Vide pour `kind = "movie"` — voir doc §6.3.
    pub seasons: Vec<SeasonSummary>,
    /// Le fichier à lire pour `kind = "movie"` uniquement. Pour
    /// `kind = "series"`, toujours `None` : la lecture se fait au niveau
    /// d'un épisode (voir `EpisodeSummary::media_file_id`), jamais au
    /// niveau du Titre — il n'y a pas de fichier unique à proposer.
    pub media_file_id: Option<i64>,
    /// Étape 7 (lot 4) : informations techniques agrégées depuis tous les
    /// fichiers média rattachés au Titre.
    pub technical: TechnicalInfo,
}

pub fn list_titles_by_category(pool: &DbPool, category_id: i64) -> Result<Vec<TitleSummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let records = title_repository::list_by_category(&conn, category_id).map_err(|e| e.to_string())?;
    let mut summaries = Vec::with_capacity(records.len());
    for record in records {
        let custom_poster =
            custom_image_repository::get(&conn, ENTITY_TYPE, record.id, POSTER_PURPOSE)
                .map_err(|e| e.to_string())?;
        summaries.push(TitleSummary {
            id: record.id,
            category_id: record.category_id,
            kind: record.kind,
            name: record.name,
            year: record.year,
            poster: custom_poster.or(record.poster_path),
        });
    }
    Ok(summaries)
}

pub fn get_title_details(pool: &DbPool, title_id: i64) -> Result<TitleDetails, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let record = title_repository::get(&conn, title_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Titre {title_id} introuvable"))?;
    let genres = title_repository::list_genres(&conn, title_id).map_err(|e| e.to_string())?;
    let studios = title_repository::list_studios(&conn, title_id).map_err(|e| e.to_string())?;
    let cast = title_repository::list_credits(&conn, title_id, "actor")
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|credit| TitleCredit {
            name: credit.name,
            character_name: credit.character_name,
        })
        .collect();
    let directors = title_repository::list_credits(&conn, title_id, "director")
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|credit| credit.name)
        .collect();
    let (seasons, media_file_id) = if record.kind == "series" {
        let season_records = season_repository::list_by_title(&conn, title_id).map_err(|e| e.to_string())?;
        let mut seasons = Vec::with_capacity(season_records.len());
        for season in season_records {
            let episode_count =
                season_repository::count_episodes(&conn, season.id).map_err(|e| e.to_string())?;
            seasons.push(SeasonSummary {
                id: season.id,
                season_number: season.season_number,
                name: season.name,
                episode_count,
            });
        }
        (seasons, None)
    } else {
        let media_file = media_repository::find_by_title(&conn, title_id).map_err(|e| e.to_string())?;
        (Vec::new(), media_file.map(|file| file.id))
    };
    let custom_poster = custom_image_repository::get(&conn, ENTITY_TYPE, title_id, POSTER_PURPOSE)
        .map_err(|e| e.to_string())?;
    let custom_banner = custom_image_repository::get(&conn, ENTITY_TYPE, title_id, BANNER_PURPOSE)
        .map_err(|e| e.to_string())?;

    // Étape 7 (lot 4) : infos techniques agrégées depuis les fichiers média
    // rattachés (directement pour un film, via les épisodes pour une série).
    let technical = aggregate_technical_info(&conn, title_id, &record.kind);

    Ok(TitleDetails {
        id: record.id,
        category_id: record.category_id,
        kind: record.kind,
        name: record.name,
        description: record.description,
        year: record.year,
        duration_seconds: record.duration_seconds,
        poster_is_custom: custom_poster.is_some(),
        poster: custom_poster.or(record.poster_path),
        banner_is_custom: custom_banner.is_some(),
        banner: custom_banner.or(record.banner_path),
        rating: record.rating,
        genres,
        studios,
        cast,
        directors,
        seasons,
        media_file_id,
        technical,
    })
}

pub fn list_episodes(pool: &DbPool, season_id: i64) -> Result<Vec<EpisodeSummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let records = episode_repository::list_by_season(&conn, season_id).map_err(|e| e.to_string())?;
    let mut episodes = Vec::with_capacity(records.len());
    for record in records {
        let media_file_id =
            media_repository::find_by_episode(&conn, record.id).map_err(|e| e.to_string())?;
        // Étape 7 (lot 4) : résolution du fichier média rattaché (si sondé),
        // pour l'afficher en badge à côté du titre de l'épisode.
        // CORRECTIF : `.as_ref()` emprunte au lieu de déplacer — sans cela,
        // `media_file_id` est consommé ici et le `.map(...)` plus bas
        // déclenche l'erreur E0382 « use of moved value ».
        let resolution = media_file_id
            .as_ref()
            .and_then(|file| media_probe_repository::get(&conn, file.id).ok().flatten())
            .and_then(|probe| probe.resolution);
        episodes.push(EpisodeSummary {
            id: record.id,
            episode_number: record.episode_number,
            name: record.name,
            description: record.description,
            duration_seconds: record.duration_seconds,
            still: record.still_path,
            media_file_id: media_file_id.map(|file| file.id),
            resolution,
        });
    }
    Ok(episodes)
}

/// `path` à `None` efface la personnalisation (retour à l'affiche
/// automatique, si elle existe).
pub fn set_custom_poster(pool: &DbPool, title_id: i64, path: Option<&str>) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    custom_image_repository::set(&conn, ENTITY_TYPE, title_id, POSTER_PURPOSE, path)
        .map_err(|e| e.to_string())
}

pub fn set_custom_banner(pool: &DbPool, title_id: i64, path: Option<&str>) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    custom_image_repository::set(&conn, ENTITY_TYPE, title_id, BANNER_PURPOSE, path)
        .map_err(|e| e.to_string())
}

/// Suppression manuelle d'un Titre depuis sa carte (grille de Catégorie,
/// Étape 5) — même logique que le nettoyage automatique des orphelins
/// après suppression d'une bibliothèque (`domain::library::delete_library`) :
/// `title_repository::delete` détache les Médias, purge la personnalisation
/// et cascade Saisons/Épisodes ; les images automatiques/personnalisées
/// détachées sont ensuite retirées du disque. Les fichiers média eux-mêmes
/// ne sont jamais touchés, qu'ils appartiennent encore à une bibliothèque
/// active ou non — même garantie que pour une bibliothèque (doc §8, Étape 5).
///
/// Si la bibliothèque source est toujours active et rescannée plus tard,
/// ses fichiers (redevenus "non appariés") peuvent être réappariés au même
/// Titre par le Metadata Service, qui est idempotent par conception (voir
/// `services::metadata::mod`, doc §6.3) — ce n'est jamais le cas pour un
/// Titre déjà orphelin (bibliothèque source déjà supprimée), qui disparaît
/// alors définitivement, faute de tout fichier restant pouvant le recréer.
pub fn delete_title(pool: &DbPool, title_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let removed_images = title_repository::delete(&conn, title_id).map_err(|e| e.to_string())?;
    for path in removed_images {
        image_store::remove_image(&path);
    }
    Ok(())
}

// ---- Explorateur (Étape 7, lot 3) ------------------------------------

pub fn search_titles(
    pool: &DbPool,
    query: title_repository::TitleSearchQuery,
) -> Result<Vec<title_repository::TitleSearchResult>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    title_repository::search_titles(&conn, &query).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchFacets {
    pub genres: Vec<String>,
    pub resolutions: Vec<String>,
    pub codecs: Vec<String>,
    pub audio_langs: Vec<String>,
}

/// Valeurs distinctes pour les filtres de l'Explorateur — les facets
/// techniques viennent de `media_probes` (lot 2), les genres du catalogue.
pub fn search_facets(pool: &DbPool) -> Result<SearchFacets, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    Ok(SearchFacets {
        genres: title_repository::all_genres(&conn).map_err(|e| e.to_string())?,
        resolutions: media_probe_repository::distinct_resolutions(&conn).map_err(|e| e.to_string())?,
        codecs: media_probe_repository::distinct_codecs(&conn).map_err(|e| e.to_string())?,
        audio_langs: media_probe_repository::distinct_audio_langs(&conn).map_err(|e| e.to_string())?,
    })
}

// ---- Informations techniques agrégées (Étape 7, lot 4) ----------------

/// Agrège les infos techniques (résolution, codec, langues) depuis tous
/// les fichiers média rattachés à ce Titre : directement via
/// `media_files.title_id` pour un film, via `episodes` + `media_files`
/// pour une série. Déduit les doublons et trie.
fn aggregate_technical_info(
    conn: &rusqlite::Connection,
    title_id: i64,
    kind: &str,
) -> TechnicalInfo {
    let mut resolutions = Vec::new();
    let mut codecs = Vec::new();
    let mut audio_langs = Vec::new();
    let mut subtitle_langs = Vec::new();

    let media_ids: Vec<i64> = if kind == "movie" {
        conn.query_row(
            "SELECT id FROM media_files WHERE title_id = ?1",
            rusqlite::params![title_id],
            |row| row.get(0),
        )
        .ok()
        .into_iter()
        .collect()
    } else {
        conn.prepare(
            "SELECT m.id FROM media_files m
             JOIN episodes e ON e.id = m.episode_id
             WHERE e.title_id = ?1",
        )
        .and_then(|mut stmt| {
            let rows = stmt.query_map(rusqlite::params![title_id], |row| row.get(0))?;
            rows.collect::<rusqlite::Result<Vec<i64>>>()
        })
        .unwrap_or_default()
    };

    for media_id in media_ids {
        if let Ok(Some(probe)) = media_probe_repository::get(conn, media_id) {
            if let Some(res) = probe.resolution {
                if !resolutions.contains(&res) {
                    resolutions.push(res);
                }
            }
            if let Some(codec) = probe.video_codec {
                if !codecs.contains(&codec) {
                    codecs.push(codec);
                }
            }
            for lang in probe.audio_langs {
                if !audio_langs.contains(&lang) {
                    audio_langs.push(lang);
                }
            }
            for lang in probe.subtitle_langs {
                if !subtitle_langs.contains(&lang) {
                    subtitle_langs.push(lang);
                }
            }
        }
    }

    resolutions.sort();
    codecs.sort();
    audio_langs.sort();
    subtitle_langs.sort();

    TechnicalInfo {
        resolutions,
        codecs,
        audio_langs,
        subtitle_langs,
    }
}