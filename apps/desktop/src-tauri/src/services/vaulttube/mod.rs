//! VaultTube (0.4.0) : gestion de chaînes/playlists YouTube avec lecture
//! via yt-dlp + mpv. Pas de clé API nécessaire — tout passe par yt-dlp
//! (extraction de métadonnées, miniatures, flux vidéo).
pub mod models;
pub mod repository;
pub mod sync;

pub use models::{SearchResult, UserPlaylist, UserPlaylistItem, VaultTubePlaylist, VaultTubeSubscription, VaultTubeVideo,};
pub use repository::VaultTubeRepository;
pub use sync::VaultTubeSync;