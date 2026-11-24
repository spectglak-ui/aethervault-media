//! Commandes VaultTube (0.4.0) — abonnements et synchronisation de
//! chaînes/playlists YouTube via yt-dlp.
use crate::services::vaulttube::{
    VaultTubePlaylist, VaultTubeRepository, VaultTubeSubscription, VaultTubeSync, VaultTubeVideo,
};
use crate::db::DbPool;
use crate::services::vaulttube::repository::{detect_mode_from_url, normalize_subscription_url};
use crate::state::AppState;
use tauri::State;

/// Les commandes qui lancent yt-dlp (plusieurs secondes) s'exécutent hors du fil principal :
/// une commande Tauri synchrone y tourne et gèle la fenêtre (même modèle que `music.rs`).
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("Opération interrompue : {e}"))?
}

#[tauri::command]
pub fn vaulttube_list_subscriptions(
    state: State<'_, AppState>,
) -> Result<Vec<VaultTubeSubscription>, String> {
    VaultTubeRepository::new(state.db_pool.clone()).list_subscriptions()
}

#[tauri::command]
pub fn vaulttube_list_videos(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<Vec<VaultTubeVideo>, String> {
    VaultTubeRepository::new(state.db_pool.clone()).list_videos(subscription_id)
}

/// Suit une chaîne ou une playlist.
///
/// `mode` (`"video"` | `"audio"`) est l'espace dans lequel on la suit (AetherFy Vidéo ou
/// AetherFy Musique) ; absent, il est deviné d'après l'adresse. La même adresse peut être
/// suivie dans les deux espaces. Déjà suivie dans le mode demandé : l'abonnement existant est
/// renvoyé (aucune erreur, aucun appel réseau).
///
/// `async` + `spawn_blocking` : yt-dlp (sonde puis première synchronisation) dure plusieurs
/// secondes ; une commande synchrone s'exécuterait sur le fil principal et gèlerait la fenêtre.
#[tauri::command]
pub async fn vaulttube_add_subscription(
    state: State<'_, AppState>,
    url: String,
    mode: Option<String>,
) -> Result<VaultTubeSubscription, String> {
    let pool = state.db_pool.clone();
    tauri::async_runtime::spawn_blocking(move || follow_subscription(pool, url, mode))
        .await
        .map_err(|e| format!("Opération interrompue : {e}"))?
}

fn follow_subscription(
    pool: DbPool,
    url: String,
    mode: Option<String>,
) -> Result<VaultTubeSubscription, String> {
    let requested: Option<&str> = match mode.as_deref() {
        None => None,
        Some(m @ ("video" | "audio")) => Some(m),
        Some(_) => return Err("Mode invalide : doit être 'video' ou 'audio'".to_string()),
    };
    let url = normalize_subscription_url(&url);
    if url.is_empty() {
        return Err("Adresse vide.".to_string());
    }

    let repo = VaultTubeRepository::new(pool.clone());
    if let Some(existing) = repo.find_subscription(&url, requested)? {
        return Ok(existing);
    }

    let sync = VaultTubeSync::new(VaultTubeRepository::new(pool));
    let (name, youtube_id, kind, thumbnail, source) = sync.probe_url(&url)?;
    let mode = requested.unwrap_or_else(|| detect_mode_from_url(&url, &name));

    let id = repo.add_subscription(&name, &url, &kind, &youtube_id, thumbnail.as_deref(), &source, mode)?;
    let sub = VaultTubeSubscription {
        id,
        name,
        url,
        kind,
        youtube_id,
        thumbnail_url: thumbnail,
        added_at: 0,
        last_synced_at: None,
        source,
        mode: mode.to_string(),
    };
    if let Err(e) = sync.sync_subscription(&sub) {
        log::warn!("[vaulttube] première synchronisation échouée : {e}");
    }
    repo.list_subscriptions()?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "Abonnement créé mais introuvable.".to_string())
}

#[tauri::command]
pub async fn vaulttube_refresh_subscription(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<usize, String> {
    let pool = state.db_pool.clone();
    blocking(move || {
        let repo = VaultTubeRepository::new(pool.clone());
        let sub = repo
            .list_subscriptions()?
            .into_iter()
            .find(|s| s.id == subscription_id)
            .ok_or_else(|| "Abonnement introuvable.".to_string())?;
        let sync = VaultTubeSync::new(VaultTubeRepository::new(pool));
        let n = sync.sync_subscription(&sub)?;
        let _ = sync.sync_playlists(&sub);
        if sub.thumbnail_url.is_none() {
            if let Ok((_name, _id, _kind, thumb, _source)) = sync.probe_url(&sub.url) {
                if let Some(t) = thumb {
                    let _ = repo.update_thumbnail(sub.id, &t);
                }
            }
        }
        Ok(n)
    })
    .await
}

#[tauri::command]
pub fn vaulttube_list_playlists(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<Vec<VaultTubePlaylist>, String> {
    VaultTubeRepository::new(state.db_pool.clone()).list_playlists(subscription_id)
}

#[tauri::command]
pub async fn vaulttube_sync_playlists(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<usize, String> {
    let pool = state.db_pool.clone();
    blocking(move || {
        let repo = VaultTubeRepository::new(pool);
        let sub = repo
            .list_subscriptions()?
            .into_iter()
            .find(|s| s.id == subscription_id)
            .ok_or_else(|| "Abonnement introuvable.".to_string())?;
        VaultTubeSync::new(repo).sync_playlists(&sub)
    })
    .await
}

#[tauri::command]
pub async fn vaulttube_preview_videos(
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<VaultTubeVideo>, String> {
    let pool = state.db_pool.clone();
    blocking(move || VaultTubeSync::new(VaultTubeRepository::new(pool)).preview_videos(&url)).await
}

#[tauri::command]
pub async fn vaulttube_search(
    state: State<'_, AppState>,
    query: String,
    source: Option<String>,
) -> Result<Vec<crate::services::vaulttube::models::SearchResult>, String> {
    let pool = state.db_pool.clone();
    blocking(move || VaultTubeSync::new(VaultTubeRepository::new(pool)).search(&query, source.as_deref())).await
}

#[tauri::command]
pub fn vaulttube_create_user_playlist(
    state: State<'_, AppState>,
    name: String,
    mode: Option<String>,
) -> Result<i64, String> {
    VaultTubeRepository::new(state.db_pool.clone())
        .create_user_playlist(&name, mode.as_deref().unwrap_or("video"))
}

#[tauri::command]
pub fn vaulttube_list_user_playlists(
    state: State<'_, AppState>,
) -> Result<Vec<crate::services::vaulttube::models::UserPlaylist>, String> {
    VaultTubeRepository::new(state.db_pool.clone()).list_user_playlists()
}

#[tauri::command]
pub fn vaulttube_delete_user_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
) -> Result<(), String> {
    VaultTubeRepository::new(state.db_pool.clone()).delete_user_playlist(playlist_id)
}

#[tauri::command]
pub fn vaulttube_list_user_playlist_items(
    state: State<'_, AppState>,
    playlist_id: i64,
) -> Result<Vec<crate::services::vaulttube::models::UserPlaylistItem>, String> {
    VaultTubeRepository::new(state.db_pool.clone()).list_user_playlist_items(playlist_id)
}

#[tauri::command]
pub fn vaulttube_add_to_user_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    youtube_id: String,
    title: String,
    thumbnail_url: Option<String>,
    duration_seconds: Option<i64>,
    channel: Option<String>,
    source: Option<String>,
) -> Result<(), String> {
    VaultTubeRepository::new(state.db_pool.clone()).add_user_playlist_item(
        playlist_id,
        &youtube_id,
        &title,
        thumbnail_url.as_deref(),
        duration_seconds,
        channel.as_deref(),
        source.as_deref().unwrap_or("youtube"),
    )
}

#[tauri::command]
pub fn vaulttube_remove_from_user_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    youtube_id: String,
) -> Result<(), String> {
    VaultTubeRepository::new(state.db_pool.clone())
        .remove_user_playlist_item(playlist_id, &youtube_id)
}

#[tauri::command]
pub fn vaulttube_reorder_user_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    item_ids: Vec<i64>,
) -> Result<(), String> {
    VaultTubeRepository::new(state.db_pool.clone()).reorder_user_playlist(playlist_id, &item_ids)
}

#[tauri::command]
pub fn vaulttube_set_user_playlist_mode(
    state: State<'_, AppState>,
    playlist_id: i64,
    mode: String,
) -> Result<(), String> {
    if mode != "video" && mode != "audio" {
        return Err("Mode invalide : doit être 'video' ou 'audio'".to_string());
    }
    VaultTubeRepository::new(state.db_pool.clone()).set_user_playlist_mode(playlist_id, &mode)
}

/// Image d'une playlist locale (data URL carrée, voir `validate_cover_image`) ; `None` la retire.
#[tauri::command]
pub fn vaulttube_set_user_playlist_cover(
    state: State<'_, AppState>,
    playlist_id: i64,
    image: Option<String>,
) -> Result<(), String> {
    VaultTubeRepository::new(state.db_pool.clone()).set_user_playlist_cover(playlist_id, image.as_deref())
}

#[tauri::command]
pub fn vaulttube_set_subscription_mode(
    state: State<'_, AppState>,
    subscription_id: i64,
    mode: String,
) -> Result<(), String> {
    if mode != "video" && mode != "audio" {
        return Err("Mode invalide : doit être 'video' ou 'audio'".to_string());
    }
    VaultTubeRepository::new(state.db_pool.clone()).set_subscription_mode(subscription_id, &mode)
}

#[tauri::command]
pub fn vaulttube_remove_subscription(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<(), String> {
    VaultTubeRepository::new(state.db_pool.clone()).remove_subscription(subscription_id)
}

/// Synchronise tous les abonnements immédiatement (bouton "Sync maintenant").
#[tauri::command]
pub fn vaulttube_sync_all_now(
    state: tauri::State<AppState>,
) -> Result<usize, String> {
    let repo = state.vaulttube_repository()?;
    let sync = state.vaulttube_sync()?;
    
    let subs = repo.list_subscriptions()?;
    let mut total = 0;
    
    for sub in &subs {
        match sync.sync_subscription(sub) {
            Ok(added) => total += added,
            Err(e) => log::warn!("[vaulttube] sync manuel : échec pour {} : {e}", sub.name),
        }
    }
    
    Ok(total)
}

/// Lance la synchronisation automatique périodique (toutes les 6h).
#[tauri::command]
pub fn vaulttube_auto_sync_start(
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let mut guard = state.auto_sync_handle.lock().unwrap();
    if guard.is_some() {
        return Ok(()); // Déjà lancé
    }
    
    let repo = state.vaulttube_repository()?;
    let sync = state.vaulttube_sync()?;
    let handle = crate::services::vaulttube::auto_sync::start(repo, sync);
    *guard = Some(handle);
    
    log::info!("[vaulttube] auto-sync démarré");
    Ok(())
}

/// Arrête la synchronisation automatique.
#[tauri::command]
pub fn vaulttube_auto_sync_stop(
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let mut guard = state.auto_sync_handle.lock().unwrap();
    if let Some(mut handle) = guard.take() {
        handle.stop();
        log::info!("[vaulttube] auto-sync arrêté");
    }
    Ok(())
}

/// 0.7.3 — récupère les commentaires d'une vidéo via yt-dlp
/// (--write-comments --skip-download --dump-json).
#[tauri::command]
pub fn vaulttube_get_comments(
    state: State<'_, AppState>,
    video_id: String,
    source: Option<String>,
) -> Result<Vec<crate::services::vaulttube::models::Comment>, String> {
    VaultTubeSync::new(VaultTubeRepository::new(state.db_pool.clone()))
        .get_comments(&video_id, source.as_deref())
}

/// 0.8.2 — télécharge une vidéo via yt-dlp dans Vidéos/AetherFy.
#[tauri::command]
pub fn vaulttube_download_video(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    video_id: String,
    source: Option<String>,
) -> Result<String, String> {
    use tauri::Manager;
    let sync = crate::services::vaulttube::VaultTubeSync::new(
        crate::services::vaulttube::VaultTubeRepository::new(state.db_pool.clone()),
    );
    let dest = app_handle
        .path()
        .video_dir()
        .map_err(|e| e.to_string())?
        .join("AetherFy");
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let dest_clone = dest.clone();
    std::thread::spawn(move || {
        if let Err(e) = sync.download_video(&video_id, source.as_deref(), &dest_clone) {
            log::warn!("[aetherfy] téléchargement échoué : {e}");
        } else {
            log::info!("[aetherfy] téléchargement terminé : {}", dest_clone.display());
        }
    });
    Ok(dest.to_string_lossy().to_string())
}