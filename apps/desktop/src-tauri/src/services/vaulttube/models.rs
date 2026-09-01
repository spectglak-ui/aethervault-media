//! Modèles de données VaultTube.
use serde::{Deserialize, Serialize};

/// Abonnement à une chaîne ou playlist YouTube.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTubeSubscription {
    pub id: i64,
    /// Nom affichable (ex: "MKBHD", "Playlist Cinéma").
    pub name: String,
    /// URL complète de la chaîne/playlist YouTube.
    pub url: String,
    /// Type : "channel" ou "playlist".
    pub kind: String,
    /// ID YouTube (ex: "UCBcRF18a7Qf58cCRy5xuWwQ" pour MKBHD).
    pub youtube_id: String,
    /// URL de la miniature (thumbnail).
    pub thumbnail_url: Option<String>,
    /// Date d'ajout (timestamp Unix).
    pub added_at: i64,
    /// Dernière synchronisation (timestamp Unix, nullable).
    pub last_synced_at: Option<i64>,
}

/// Vidéo extraite d'une chaîne/playlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTubeVideo {
    pub id: i64,
    pub subscription_id: i64,
    /// ID YouTube de la vidéo (ex: "dQw4w9WgXcQ").
    pub youtube_id: String,
    pub title: String,
    /// Description (tronquée à 500 caractères).
    pub description: Option<String>,
    /// URL de la miniature.
    pub thumbnail_url: Option<String>,
    /// Durée en secondes.
    pub duration_seconds: Option<i64>,
    /// Date de publication (timestamp Unix).
    pub published_at: Option<i64>,
    /// Date d'ajout en base (timestamp Unix).
    pub added_at: i64,
}

/// Playlist publique d'une chaîne suivie.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTubePlaylist {
    pub id: i64,
    pub subscription_id: i64,
    /// ID YouTube de la playlist (ex: "PLxxxx").
    pub youtube_id: String,
    pub title: String,
    pub thumbnail_url: Option<String>,
    pub video_count: Option<i64>,
    pub added_at: i64,
}

/// Résultat d'une recherche YouTube (vidéo, chaîne ou playlist).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub url: String,
    /// "video" | "channel" | "playlist"
    pub kind: String,
    pub thumbnail_url: Option<String>,
    /// Nom de la chaîne (vidéos) / absent pour chaînes et playlists.
    pub channel: Option<String>,
    /// Durée en secondes (vidéos uniquement).
    pub duration_seconds: Option<i64>,
    /// Nombre de vidéos (playlists uniquement).
    pub video_count: Option<i64>,
}

/// Playlist locale créée par l'utilisateur (indépendante de YouTube).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPlaylist {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub item_count: i64,
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
}