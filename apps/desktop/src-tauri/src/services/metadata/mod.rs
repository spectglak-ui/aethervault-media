//! Metadata Service (doc §3.4, §6.3) : associe les fichiers découverts par
//! le File Scanner (Étape 2) à un Titre/Épisode, en interrogeant une liste
//! de fournisseurs dans l'ordre — le premier qui répond l'emporte. Un seul
//! fournisseur existe à ce jour (`local_provider`, toujours disponible,
//! sans réseau) ; un futur fournisseur en ligne (TMDB, TVDB...) s'ajoute
//! par une simple entrée supplémentaire dans `MetadataService::new`, sans
//! toucher au reste de ce module ni à `match_library` — voir doc §8,
//! Étape 4, et §3.4.

mod filename;
mod local_provider;
mod path_hints;

use crate::db::repositories::{
    category_repository, episode_repository, folder_repository, media_repository,
    season_repository, title_repository,
};
use crate::db::DbPool;
use serde::Serialize;

/// Ce que l'analyse du nom de fichier permet d'affirmer, avant tout appel
/// à un fournisseur — la requête commune à tous les fournisseurs (locaux
/// ou futurs en ligne).
pub struct ParsedQuery {
    pub title_guess: String,
    pub year: Option<i32>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
}

/// Ce qu'un fournisseur peut renseigner. `Option`/`Vec` vides pour ce
/// qu'il ne sait pas — jamais de valeur inventée.
pub struct FetchedMetadata {
    pub name: String,
    pub description: Option<String>,
    pub year: Option<i32>,
    pub rating: Option<f64>,
    pub genres: Vec<String>,
    pub studios: Vec<String>,
    /// (nom, personnage) — le personnage reste `None` quand le fournisseur
    /// ne le sait pas (toujours le cas pour le fournisseur local).
    pub cast: Vec<(String, Option<String>)>,
    pub directors: Vec<String>,
    pub poster_path: Option<String>,
    pub banner_path: Option<String>,
}

/// Un fournisseur de métadonnées — voir doc §3.4. Chaque fournisseur
/// répond en local (cache, fichier `.nfo`, analyse de nom de fichier) ou
/// via un appel réseau ; `MetadataService` ne fait aucune distinction
/// entre les deux, elle appelle simplement `fetch` dans l'ordre déclaré.
pub trait MetadataProvider: Send + Sync {
    #[allow(dead_code)] // utile pour les logs/diagnostics dès qu'un second fournisseur existera.
    fn id(&self) -> &'static str;
    fn fetch(&self, query: &ParsedQuery) -> Option<FetchedMetadata>;
}

#[derive(Debug, Clone, Serialize)]
pub struct MatchSummary {
    pub library_id: i64,
    pub matched: u64,
    pub skipped: u64,
}

pub struct MetadataService {
    providers: Vec<Box<dyn MetadataProvider>>,
}

impl Default for MetadataService {
    fn default() -> Self {
        Self::new()
    }
}

impl MetadataService {
    pub fn new() -> Self {
        Self {
            providers: vec![Box::new(local_provider::LocalProvider)],
        }
    }

    /// Traite tous les fichiers pas encore appariés d'une bibliothèque
    /// (`media_repository::list_unmatched`) et les rattache à un Titre
    /// (nature `movie`) ou un Épisode (nature `series`). Idempotent :
    /// rejouer cette fonction ne retraite jamais un fichier déjà apparié —
    /// un rafraîchissement complet des métadonnées déjà appariées est un
    /// besoin différent, hors périmètre de l'Étape 4.
    pub fn match_library(
        &self,
        pool: &DbPool,
        library_id: i64,
        category_id: i64,
    ) -> Result<MatchSummary, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;

        let category = category_repository::get(&conn, category_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Catégorie {category_id} introuvable"))?;

        let files = media_repository::list_unmatched(&conn, library_id).map_err(|e| e.to_string())?;

        // Bornes de la bibliothèque, calculées une seule fois : voir
        // `path_hints::detect` — évite de confondre la racine d'une
        // bibliothèque dédiée à un seul Titre avec un dossier de Titre.
        let library_roots: Vec<String> = folder_repository::list_by_library(&conn, library_id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|folder| folder.path)
            .collect();

        let mut matched = 0u64;
        let mut skipped = 0u64;

        for file in files {
            let mut parsed = filename::parse(&file.file_name);

            // Le nom de fichier n'a révélé aucune saison : on complète par
            // le dossier parent avant de continuer, plutôt que de laisser
            // chaque fichier former son propre Titre isolé (doc §6.3,
            // erratum Étape 4 — voir services::metadata::path_hints).
            if parsed.season_number.is_none() {
                if let Some(hint) = path_hints::detect(&file.path, &library_roots) {
                    parsed.title_guess = hint.title_guess;
                    parsed.season_number = Some(hint.season_number);
                }
            }

            // Nature déterminée par la Catégorie plutôt que par le seul nom
            // de fichier (doc §6.3) : Films est toujours "movie",
            // Séries/Anime toujours "series", Documentaires suit ce que
            // détecte l'analyse du nom de fichier (les deux natures sont
            // possibles pour cette catégorie, sans troisième modèle).
            let kind = match category.key.as_str() {
                "movies" => "movie",
                "series" | "anime" => "series",
                "documentaries" => {
                    if parsed.season_number.is_some() {
                        "series"
                    } else {
                        "movie"
                    }
                }
                // Catégorie non reconnue (ex. future catégorie
                // personnalisée, doc §6.1) : ni film ni série assurés par
                // construction — fichier laissé de côté plutôt que deviné.
                _ => {
                    skipped += 1;
                    continue;
                }
            };

            let query = ParsedQuery {
                title_guess: parsed.title_guess.clone(),
                year: parsed.year,
                season_number: parsed.season_number,
                episode_number: parsed.episode_number,
            };

            let Some(metadata) = self.fetch(&query) else {
                skipped += 1;
                continue;
            };

            let title_id = title_repository::find_or_create(
                &conn,
                category_id,
                kind,
                &metadata.name,
                metadata.year.map(i64::from),
                "local",
            )
            .map_err(|e| e.to_string())?;

            apply_metadata(&conn, title_id, &metadata)?;

            if kind == "movie" {
                media_repository::link_to_title(&conn, file.id, title_id)
                    .map_err(|e| e.to_string())?;
            } else {
                let season_number = i64::from(parsed.season_number.unwrap_or(1));
                let season_id = season_repository::find_or_create(&conn, title_id, season_number)
                    .map_err(|e| e.to_string())?;

                // Un épisode sans numéro détecté (nom de fichier atypique)
                // reçoit le prochain numéro disponible dans sa saison
                // plutôt que d'être ignoré : un ordre approximatif,
                // corrigible plus tard par un fournisseur en ligne, vaut
                // mieux qu'un fichier orphelin invisible de la navigation.
                let episode_number = match parsed.episode_number {
                    Some(number) => i64::from(number),
                    None => next_episode_number(&conn, season_id).map_err(|e| e.to_string())?,
                };

                let episode_id = episode_repository::find_or_create(
                    &conn,
                    title_id,
                    season_id,
                    episode_number,
                )
                .map_err(|e| e.to_string())?;
                media_repository::link_to_episode(&conn, file.id, episode_id)
                    .map_err(|e| e.to_string())?;
            }

            matched += 1;
        }

        Ok(MatchSummary {
            library_id,
            matched,
            skipped,
        })
    }

    fn fetch(&self, query: &ParsedQuery) -> Option<FetchedMetadata> {
        self.providers.iter().find_map(|provider| provider.fetch(query))
    }
}

fn apply_metadata(
    conn: &rusqlite::Connection,
    title_id: i64,
    metadata: &FetchedMetadata,
) -> Result<(), String> {
    title_repository::apply_metadata(
        conn,
        title_id,
        metadata.description.as_deref(),
        // Durée technique du fichier (à distinguer de la durée annoncée
        // par un fournisseur) : hors périmètre de cette première passe,
        // laissée à une itération future plutôt que sondée ici par mpv
        // pour chaque fichier — voir doc §8, Étape 4, note de portée.
        None,
        metadata.rating,
        metadata.poster_path.as_deref(),
        metadata.banner_path.as_deref(),
        "local",
    )
    .map_err(|e| e.to_string())?;

    for genre in &metadata.genres {
        title_repository::attach_genre(conn, title_id, genre).map_err(|e| e.to_string())?;
    }
    for studio in &metadata.studios {
        title_repository::attach_studio(conn, title_id, studio).map_err(|e| e.to_string())?;
    }
    for (index, (name, character)) in metadata.cast.iter().enumerate() {
        title_repository::attach_credit(conn, title_id, name, "actor", character.as_deref(), index as i64)
            .map_err(|e| e.to_string())?;
    }
    for (index, name) in metadata.directors.iter().enumerate() {
        title_repository::attach_credit(conn, title_id, name, "director", None, index as i64)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn next_episode_number(conn: &rusqlite::Connection, season_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(episode_number), 0) + 1 FROM episodes WHERE season_id = ?1",
        rusqlite::params![season_id],
        |row| row.get(0),
    )
}
