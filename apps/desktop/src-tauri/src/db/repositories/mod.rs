//! Un repository par entité : seul endroit du code autorisé à écrire du SQL.
//! Le reste de l'application (domain/services/commands) passe par ces
//! fonctions plutôt que d'exécuter des requêtes directement.

pub mod category_repository;
pub mod custom_image_repository;
pub mod episode_repository;
pub mod folder_repository;
pub mod library_repository;
pub mod media_repository;
pub mod playback_repository;
pub mod player_settings_repository;
pub mod private_image_repository;
pub mod private_repository;
pub mod private_video_repository;
pub mod profile_repository;
pub mod season_repository;
pub mod title_repository;
pub mod vault_security_repository;
pub mod window_state_repository;
