//! Commandes VaultTube (0.4.0) — abonnements et synchronisation de
//! chaînes/playlists YouTube via yt-dlp.
use crate::services::vaulttube::{
    VaultTubePlaylist, VaultTubeRepository, VaultTubeSubscription, VaultTubeSync, VaultTubeVideo,
};
use crate::services::vaulttube::repository::detect_mode_from_url;
use crate::state::AppState;
use tauri::State;

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

#[tauri::command]
pub fn vaulttube_add_subscription(
    state: State<'_, AppState>,
    url: String,
) -> Result<VaultTubeSubscription, String> {
    let repo = VaultTubeRepository::new(state.db_pool.clone());
    let sync = VaultTubeSync::new(VaultTubeRepository::new(state.db_pool.clone()));
    let (name, youtube_id, kind, thumbnail, source) = sync.probe_url(&url)?;
    
    let mode = detect_mode_from_url(&url, &name);
    
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
pub fn vaulttube_refresh_subscription(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<usize, String> {
    let repo = VaultTubeRepository::new(state.db_pool.clone());
    let sub = repo
        .list_subscriptions()?
        .into_iter()
        .find(|s| s.id == subscription_id)
        .ok_or_else(|| "Abonnement introuvable.".to_string())?;
    let sync = VaultTubeSync::new(VaultTubeRepository::new(state.db_pool.clone()));
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
}

#[tauri::command]
pub fn vaulttube_list_playlists(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<Vec<VaultTubePlaylist>, String> {
    VaultTubeRepository::new(state.db_pool.clone()).list_playlists(subscription_id)
}

#[tauri::command]
pub fn vaulttube_sync_playlists(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<usize, String> {
    let repo = VaultTubeRepository::new(state.db_pool.clone());
    let sub = repo
        .list_subscriptions()?
        .into_iter()
        .find(|s| s.id == subscription_id)
        .ok_or_else(|| "Abonnement introuvable.".to_string())?;
    VaultTubeSync::new(repo).sync_playlists(&sub)
}

#[tauri::command]
pub fn vaulttube_preview_videos(
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<VaultTubeVideo>, String> {
    VaultTubeSync::new(VaultTubeRepository::new(state.db_pool.clone())).preview_videos(&url)
}

#[tauri::command]
pub fn vaulttube_search(
    state: State<'_, AppState>,
    query: String,
    source: Option<String>,
) -> Result<Vec<crate::services::vaulttube::models::SearchResult>, String> {
    VaultTubeSync::new(VaultTubeRepository::new(state.db_pool.clone()))
        .search(&query, source.as_deref())
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