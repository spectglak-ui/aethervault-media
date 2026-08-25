//! Couche métier : combine les repositories entre eux et avec des
//! vérifications qui ne relèvent pas de la base de données (ex. existence
//! d'un chemin sur le disque). Les commandes Tauri (`commands/`) restent de
//! simples wrappers qui appellent ce module — aucune règle métier ne doit
//! vivre directement dans un fichier de `commands/`.

pub mod category;
pub mod library;
pub mod playback;
pub mod privacy;
pub mod private_image;
pub mod private_video;
pub mod profile;
pub mod title;
