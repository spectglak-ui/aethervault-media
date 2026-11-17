//! AetherFy Musique (0.7.9) — recherche de catalogue et résolution de lecture.
//!
//! Les requêtes réseau (MusicBrainz, YouTube via yt-dlp) bloquent : elles
//! s'exécutent hors du fil principal pour ne jamais figer l'interface.

use crate::services::music::models::{MusicAlbum, MusicAlbumDetail, MusicSearchResponse};
use crate::services::music::musicbrainz;
use crate::services::music::resolver::{self, Candidate, ResolveRequest, Resolution};
use crate::services::music::web;
use crate::services::vaulttube::models::SearchResult;
use crate::services::vaulttube::{VaultTubeRepository, VaultTubeSync};
use crate::state::AppState;

const MAX_QUERY_CHARS: usize = 200;

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("Opération interrompue : {e}"))?
}

fn clean_query(query: String) -> Result<String, String> {
    let query = query.trim().to_string();
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err("La recherche est trop longue.".to_string());
    }
    Ok(query)
}

/// Recherche dans le catalogue : `kind` = `track` | `album` | `artist`.
#[tauri::command]
pub async fn music_search(kind: String, query: String) -> Result<MusicSearchResponse, String> {
    let query = clean_query(query)?;
    blocking(move || musicbrainz::search(&kind, &query)).await
}

/// Discographie d'un artiste (albums, EP, singles).
#[tauri::command]
pub async fn music_artist_albums(artist_id: String) -> Result<Vec<MusicAlbum>, String> {
    blocking(move || musicbrainz::artist_albums(&artist_id)).await
}

/// Pistes d'un album ; `null` si le catalogue n'en connaît pas la liste.
#[tauri::command]
pub async fn music_album_tracks(album_id: String) -> Result<Option<MusicAlbumDetail>, String> {
    blocking(move || musicbrainz::album_tracks(&album_id)).await
}

/// Playlists YouTube correspondant à la recherche.
#[tauri::command]
pub async fn music_search_playlists(
    state: tauri::State<'_, AppState>,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    let query = clean_query(query)?;
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let pool = state.db_pool.clone();
    blocking(move || VaultTubeSync::new(VaultTubeRepository::new(pool)).search_playlists(&query)).await
}

/// Livres audio : vidéos YouTube d'au moins 30 minutes correspondant à la recherche.
#[tauri::command]
pub async fn music_search_audiobooks(
    state: tauri::State<'_, AppState>,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    let query = clean_query(query)?;
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let pool = state.db_pool.clone();
    blocking(move || {
        let sync = VaultTubeSync::new(VaultTubeRepository::new(pool));
        let found = sync.search(&format!("{query} livre audio"), Some("youtube"))?;
        Ok(web::keep_audiobooks(found))
    })
    .await
}

/// Retrouve la vidéo YouTube à jouer pour un titre (voir `services::music::resolver`).
#[tauri::command]
pub async fn music_resolve_track(
    state: tauri::State<'_, AppState>,
    mbid: Option<String>,
    artist: String,
    title: String,
    duration_ms: Option<u64>,
) -> Result<Resolution, String> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Err("Titre ou artiste manquant.".to_string());
    }
    let pool = state.db_pool.clone();
    blocking(move || {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let request = ResolveRequest { mbid, artist, title, duration_ms };
        let search_pool = pool.clone();
        let search = move |query: &str| -> Result<Vec<Candidate>, String> {
            let results = VaultTubeSync::new(VaultTubeRepository::new(search_pool.clone())).search(query, Some("youtube"))?;
            Ok(results
                .into_iter()
                .filter(|r| r.kind == "video")
                .map(|r| Candidate {
                    video_id: r.id,
                    title: r.title,
                    channel: r.channel.unwrap_or_default(),
                    duration_s: r.duration_seconds,
                })
                .collect())
        };
        resolver::resolve(&conn, &request, &search)
    })
    .await
}

/// L'utilisateur choisit lui-même la version à jouer pour un titre.
#[tauri::command]
pub fn music_set_match(state: tauri::State<'_, AppState>, track_key: String, video_id: String) -> Result<(), String> {
    let conn = state.get_conn()?;
    resolver::set_manual_match(&conn, &track_key, &video_id)
}
