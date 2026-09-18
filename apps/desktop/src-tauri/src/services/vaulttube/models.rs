//! Modèles de données VaultTube / AetherFy.
use serde::{Deserialize, Serialize};

/// Abonnement à une chaîne ou playlist (YouTube, Dailymotion, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTubeSubscription {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub kind: String,
    pub youtube_id: String,
    pub thumbnail_url: Option<String>,
    pub added_at: i64,
    pub last_synced_at: Option<i64>,
    /// Source : "youtube" | "dailymotion" | "vimeo" | "peertube" | "generic"
    pub source: String,
    /// Mode de lecture : "video" (interface YouTube) ou "audio" (interface Spotify)
    pub mode: String,
}

/// Vidéo extraite d'une chaîne/playlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTubeVideo {
    pub id: i64,
    pub subscription_id: i64,
    pub youtube_id: String,
    pub title: String,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<i64>,
    pub published_at: Option<i64>,
    pub added_at: i64,
    pub source: String,
    pub mode: String,
}

/// Playlist publique d'une chaîne suivie.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTubePlaylist {
    pub id: i64,
    pub subscription_id: i64,
    pub youtube_id: String,
    pub title: String,
    pub thumbnail_url: Option<String>,
    pub video_count: Option<i64>,
    pub added_at: i64,
    pub source: String,
}

/// Résultat d'une recherche (vidéo, chaîne ou playlist).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub url: String,
    pub kind: String,
    pub thumbnail_url: Option<String>,
    pub channel: Option<String>,
    pub duration_seconds: Option<i64>,
    pub video_count: Option<i64>,
    pub source: String,
}

/// Playlist locale créée par l'utilisateur (indépendante de YouTube).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPlaylist {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub item_count: i64,
    /// Mode de lecture : "video" ou "audio"
    pub mode: String,
}

/// Élément d'une playlist locale (l'ordre = `position`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPlaylistItem {
    pub id: i64,
    pub playlist_id: i64,
    pub youtube_id: String,
    pub title: String,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<i64>,
    pub channel: Option<String>,
    pub position: i64,
    pub added_at: i64,
    pub source: String,
    pub mode: String,
}