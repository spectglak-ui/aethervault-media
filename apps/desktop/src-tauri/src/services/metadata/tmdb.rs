//! Fournisseur en ligne TMDB (Étape 7) : enrichit les Titres (synopsis,
//! genres, studios, casting, réalisateurs, affiche/bannière, tmdb_id/
//! imdb_id) par recherche nom+année+nature puis fiche détaillée — même
//! modèle que Jellyfin (TMDB ID + IMDb ID).
//!
//! Choix d'architecture (validé) : l'enrichissement est une PASSE dédiée
//! (`enrich_library`) chaînée après l'appariement local, plutôt qu'un
//! second fournisseur dans `MetadataService::new` — elle couvre d'un seul
//! mécanisme les fichiers nouvellement appariés ET le catalogue existant,
//! sans toucher au trait `MetadataProvider` ni à `match_library`.
//!
//! Images téléchargées dans `<data_dir>/metadata/tmdb/` (chemins locaux
//! stockés en base — jamais d'URL morte hors-ligne, cohérent doc §9).
//! Best-effort + throttle 250 ms/titre : une erreur réseau ou un titre
//! introuvable ne bloque jamais la chaîne de scan.

use crate::db::repositories::{library_repository, settings_repository, title_repository};
use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const API_BASE: &str = "https://api.themoviedb.org/3";
const IMG_BASE: &str = "https://image.tmdb.org/t/p";
/// Intervalle minimal entre deux titres — respecte la limite de débit
/// TMDB sans nécessiter de file complexe.
const THROTTLE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataSettings {
    pub api_key: String,
    pub language: String,
    pub auto_enrich: bool,
}

pub fn load_settings(conn: &rusqlite::Connection) -> MetadataSettings {
    MetadataSettings {
        api_key: settings_repository::get(conn, "tmdb_api_key")
            .ok()
            .flatten()
            .unwrap_or_default(),
        language: settings_repository::get(conn, "tmdb_language")
            .ok()
            .flatten()
            .unwrap_or_else(|| "fr-FR".to_string()),
        auto_enrich: settings_repository::get(conn, "tmdb_auto_enrich")
            .ok()
            .flatten()
            .map(|v| v == "1")
            .unwrap_or(true),
    }
}

pub fn save_settings(
    conn: &rusqlite::Connection,
    settings: &MetadataSettings,
) -> Result<(), String> {
    settings_repository::set(conn, "tmdb_api_key", &settings.api_key).map_err(|e| e.to_string())?;
    settings_repository::set(conn, "tmdb_language", &settings.language)
        .map_err(|e| e.to_string())?;
    settings_repository::set(
        conn,
        "tmdb_auto_enrich",
        if settings.auto_enrich { "1" } else { "0" },
    )
    .map_err(|e| e.to_string())
}

/// Encodage percent minimal (requêtes de recherche) — évite d'ajouter un
/// crate `urlencoding` pour dix lignes.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn get_json(url: &str) -> Option<serde_json::Value> {
    log::debug!("[tmdb] GET {}", url);
    let resp = match ureq::get(url).timeout(Duration::from_secs(10)).call() {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[tmdb] erreur réseau pour {} : {:?}", url, e);
            return None;
        }
    };
    if resp.status() != 200 {
        log::warn!("[tmdb] statut HTTP {} pour {}", resp.status(), url);
        return None;
    }
    let mut body = String::new();
    if let Err(e) = resp.into_reader().read_to_string(&mut body) {
        log::warn!("[tmdb] lecture corps impossible pour {} : {:?}", url, e);
        return None;
    }
    match serde_json::from_str(&body) {
        Ok(v) => Some(v),
        Err(e) => {
            log::warn!(
                "[tmdb] JSON invalide pour {} : {:?} — corps : {}",
                url,
                e,
                &body[..body.len().min(200)]
            );
            None
        }
    }
}

fn download_image(url: &str, dest: &std::path::Path) -> Option<()> {
    if dest.exists() {
        return Some(());
    }
    let resp = ureq::get(url).timeout(Duration::from_secs(15)).call().ok()?;
    let mut bytes = Vec::new();
    resp.into_reader().read_to_end(&mut bytes).ok()?;
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(dest, bytes).ok()
}

pub struct TmdbClient {
    pub api_key: String,
    pub lang: String,
}

pub struct TmdbDetails {
    pub name: String,
    pub description: Option<String>,
    pub year: Option<i32>,
    pub rating: Option<f64>,
    pub genres: Vec<String>,
    pub studios: Vec<String>,
    pub cast: Vec<(String, Option<String>)>,
    pub directors: Vec<String>,
    pub poster_path: Option<String>,
    pub banner_path: Option<String>,
    pub imdb_id: Option<String>,
}

impl TmdbClient {
    fn url(&self, path: &str, extra: &str, lang: &str) -> String {
        format!("{API_BASE}{path}?api_key={}&language={lang}{extra}", self.api_key)
    }

    /// Recherche par nom (+ année si connue) ; renvoie le TMDB ID du
    /// meilleur candidat (nom exact insensible à la casse sinon premier
    /// résultat).
    pub fn search_title(&self, kind: &str, query: &str, year: Option<i32>) -> Option<i64> {
        let path = if kind == "movie" {
            "/search/movie"
        } else {
            "/search/tv"
        };
        let year_param = match year {
            Some(y) => {
                if kind == "movie" {
                    format!("&year={y}")
                } else {
                    format!("&first_air_date_year={y}")
                }
            }
            None => String::new(),
        };
        let v = get_json(&self.url(
            path,
            &format!("&query={}{}", url_encode(query), year_param),
            &self.lang,
        ))?;
        let results = v.get("results")?.as_array()?;
        let pick = results
            .iter()
            .find(|r| {
                let rn = r
                    .get("title")
                    .or_else(|| r.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or_default();
                rn.eq_ignore_ascii_case(query)
            })
            .or_else(|| results.first());
        pick.and_then(|r| r.get("id").and_then(|i| i.as_i64()))
    }

    /// Fiche détaillée + crédits + IDs externes ; images téléchargées en
    /// local. Repli `en-US` pour le synopsis si le français est vide.
    pub fn fetch_details(&self, kind: &str, tmdb_id: i64, data_dir: &str) -> Option<TmdbDetails> {
        let path = if kind == "movie" {
            format!("/movie/{tmdb_id}")
        } else {
            format!("/tv/{tmdb_id}")
        };
        let v = get_json(&self.url(
            &path,
            "&append_to_response=credits,external_ids",
            &self.lang,
        ))?;
        let name = v
            .get("title")
            .or_else(|| v.get("name"))
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string();
        let mut overview = v
            .get("overview")
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string();
        let date = v
            .get("release_date")
            .or_else(|| v.get("first_air_date"))
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string();
        let year = date.get(0..4).and_then(|y| y.parse::<i32>().ok());
        let rating = v.get("vote_average").and_then(|x| x.as_f64());
        if overview.is_empty() && self.lang != "en-US" {
            if let Some(en) = get_json(&self.url(&path, "", "en-US")) {
                overview = en
                    .get("overview")
                    .and_then(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string();
            }
        }
        let names = |key: &str| -> Vec<String> {
            v.get(key)
                .and_then(|g| g.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|g| g.get("name").and_then(|n| n.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default()
        };
        let genres = names("genres");
        let studios = names(if kind == "movie" {
            "production_companies"
        } else {
            "networks"
        });
        let (cast, directors) = v
            .get("credits")
            .map(|credits| {
                let cast: Vec<(String, Option<String>)> = credits
                    .get("cast")
                    .and_then(|c| c.as_array())
                    .map(|arr| {
                        arr.iter()
                            .take(10)
                            .filter_map(|p| {
                                let n = p.get("name")?.as_str()?.to_string();
                                let c = p
                                    .get("character")
                                    .and_then(|c| c.as_str())
                                    .map(String::from);
                                Some((n, c))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let directors: Vec<String> = credits
                    .get("crew")
                    .and_then(|c| c.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter(|p| p.get("job").and_then(|j| j.as_str()) == Some("Director"))
                            .filter_map(|p| p.get("name").and_then(|n| n.as_str()).map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                (cast, directors)
            })
            .unwrap_or_default();
        let imdb_id = v
            .get("external_ids")
            .and_then(|e| e.get("imdb_id"))
            .and_then(|i| i.as_str())
            .map(String::from);
        let img_dir = std::path::Path::new(data_dir).join("metadata").join("tmdb");
        let poster_path = v.get("poster_path").and_then(|p| p.as_str()).and_then(|p| {
            let dest = img_dir.join(format!("{tmdb_id}_poster.jpg"));
            download_image(&format!("{IMG_BASE}/w500{p}"), &dest)
                .map(|()| dest.to_string_lossy().to_string())
        });
        let banner_path = v.get("backdrop_path").and_then(|p| p.as_str()).and_then(|p| {
            let dest = img_dir.join(format!("{tmdb_id}_backdrop.jpg"));
            download_image(&format!("{IMG_BASE}/w1280{p}"), &dest)
                .map(|()| dest.to_string_lossy().to_string())
        });
        Some(TmdbDetails {
            name,
            description: if overview.is_empty() {
                None
            } else {
                Some(overview)
            },
            year,
            rating,
            genres,
            studios,
            cast,
            directors,
            poster_path,
            banner_path,
            imdb_id,
        })
    }

    /// Bande-annonce officielle (0.3.0) : endpoint TMDB « videos » —
    /// retourne TOUTES les vidéos YouTube disponibles (triées par priorité :
    /// Trailer officiel > Trailer > autres vidéos) — le frontend essaiera
    /// la première, puis la suivante en cas d'erreur (fallback automatique).
    /// ⚠️ L'endpoint « videos » FILTRE par langue : repli en-US si aucun
    /// résultat dans la langue du profil (catalogue le plus complet).
    pub fn fetch_trailer_keys(&self, kind: &str, tmdb_id: i64) -> Vec<String> {
        let path = if kind == "movie" {
            format!("/movie/{tmdb_id}/videos")
        } else {
            format!("/tv/{tmdb_id}/videos")
        };
        fn extract_keys(v: &serde_json::Value) -> Vec<String> {
            let Some(results) = v.get("results").and_then(|r| r.as_array()) else {
                return Vec::new();
            };
            let is_youtube =
                |r: &serde_json::Value| r.get("site").and_then(|s| s.as_str()) == Some("YouTube");
            let mut official_trailers = Vec::new();
            let mut trailers = Vec::new();
            let mut others = Vec::new();
            for r in results {
                if !is_youtube(r) {
                    continue;
                }
                let Some(key) = r.get("key").and_then(|k| k.as_str()).map(String::from) else {
                    continue;
                };
                let is_trailer = r.get("type").and_then(|t| t.as_str()) == Some("Trailer");
                let is_official = r.get("official").and_then(|o| o.as_bool()).unwrap_or(false);
                if is_trailer && is_official {
                    official_trailers.push(key);
                } else if is_trailer {
                    trailers.push(key);
                } else {
                    others.push(key);
                }
            }
            let mut keys = Vec::new();
            keys.extend(official_trailers);
            keys.extend(trailers);
            keys.extend(others);
            keys
        }
        let first = get_json(&self.url(&path, "", &self.lang));
        let keys = first.as_ref().map(extract_keys).unwrap_or_default();
        if !keys.is_empty() {
            return keys;
        }
        if self.lang != "en-US" {
            let fallback = get_json(&self.url(&path, "", "en-US"));
            return fallback.map(|v| extract_keys(&v)).unwrap_or_default();
        }
        Vec::new()
    }
}

/// Passe d'enrichissement TMDB d'une bibliothèque (Étape 7) : tous les
/// Titres de sa catégorie sans `tmdb_id`. Chaînée après l'appariement
/// (commands::library), best-effort, throttlée, avec progression
/// `library:scan-progress` phase "tmdb".
pub fn enrich_library(app: &AppHandle, pool: &DbPool, data_dir: &str, library_id: i64) {
    let Ok(conn) = pool.get() else { return };
    let settings = load_settings(&conn);
    if !settings.auto_enrich || settings.api_key.is_empty() {
        log::info!("[tmdb] enrichissement sauté (clé absente ou option désactivée).");
        return;
    }
    let category_id = match library_repository::get(&conn, library_id) {
        Ok(Some(library)) => match library.category_id {
            Some(id) => id,
            None => return,
        },
        _ => return,
    };
    let titles = match title_repository::list_missing_tmdb_by_category(&conn, category_id) {
        Ok(titles) => titles,
        Err(e) => {
            log::error!("[tmdb] lecture des titres à enrichir impossible : {e}");
            return;
        }
    };
    if titles.is_empty() {
        return;
    }
    log::info!(
        "[tmdb] bibliothèque {library_id} : {} titre(s) à enrichir.",
        titles.len()
    );
    let client = TmdbClient {
        api_key: settings.api_key,
        lang: settings.language,
    };
    let total = titles.len() as u64;
    let mut processed: u64 = 0;
    let mut enriched = 0u32;
    let mut failed = 0u32;
    let mut last_emit: Option<Instant> = None;
    for title in titles {
        let now = Instant::now();
        if last_emit
            .map(|previous| now.duration_since(previous) >= Duration::from_millis(150))
            .unwrap_or(true)
        {
            last_emit = Some(now);
            let _ = app.emit(
                "library:scan-progress",
                serde_json::json!({
                    "library_id": library_id,
                    "phase": "tmdb",
                    "processed": processed,
                    "total": total,
                    "current": title.name,
                }),
            );
        }
        let result = client
            .search_title(&title.kind, &title.name, title.year.map(|y| y as i32))
            .and_then(|tmdb_id| {
                let details = client.fetch_details(&title.kind, tmdb_id, data_dir)?;
                let applied = title_repository::apply_metadata(
                    &conn,
                    title.id,
                    details.description.as_deref(),
                    None,
                    details.rating,
                    details.poster_path.as_deref(),
                    details.banner_path.as_deref(),
                    "tmdb",
                )
                .and_then(|()| {
                    for genre in &details.genres {
                        title_repository::attach_genre(&conn, title.id, genre)?;
                    }
                    for studio in &details.studios {
                        title_repository::attach_studio(&conn, title.id, studio)?;
                    }
                    for (index, (name, character)) in details.cast.iter().enumerate() {
                        title_repository::attach_credit(
                            &conn,
                            title.id,
                            name,
                            "actor",
                            character.as_deref(),
                            index as i64,
                        )?;
                    }
                    for (index, name) in details.directors.iter().enumerate() {
                        title_repository::attach_credit(
                            &conn,
                            title.id,
                            name,
                            "director",
                            None,
                            index as i64,
                        )?;
                    }
                    title_repository::set_online_ids(&conn, title.id, tmdb_id, details.imdb_id.as_deref())
                });
                applied.map(|()| tmdb_id).ok()
            });
        match result {
            Some(_) => enriched += 1,
            None => failed += 1,
        }
        processed += 1;
        std::thread::sleep(THROTTLE);
    }
    let _ = app.emit(
        "library:scan-progress",
        serde_json::json!({
            "library_id": library_id,
            "phase": "tmdb",
            "processed": processed,
            "total": total,
            "current": "",
        }),
    );
    log::info!(
        "[tmdb] bibliothèque {library_id} : {enriched} titre(s) enrichi(s), {failed} échec(s)."
    );
}