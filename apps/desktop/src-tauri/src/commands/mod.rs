//! Regroupe toutes les commandes Tauri exposées au frontend.
//!
//! Convention adoptée dès cette étape : un fichier par domaine fonctionnel
//! (ex. `status.rs`, puis plus tard `library.rs`, `playback.rs`,
//! `profile.rs`...).
//!
//! Chaque sous-module est déclaré `pub` (et non réexporté via `pub use`) :
//! la macro `tauri::generate_handler!` a besoin du chemin complet où le
//! `#[tauri::command]` a été appliqué (ex. `commands::status::get_app_status`)
//! pour retrouver les éléments cachés qu'elle génère juste à côté de la
//! fonction. Un `pub use` réexporte la fonction mais pas ces éléments
//! cachés, ce qui provoque une erreur de compilation si `generate_handler!`
//! est appelé avec le chemin réexporté au lieu du chemin d'origine —
//! enregistrer chaque commande dans `lib.rs` via son chemin de module
//! complet (`commands::<fichier>::<fonction>`).

pub mod category;
pub mod library;
pub mod playback;
pub mod player_settings;
pub mod private_image;
pub mod private_video;
pub mod profile;
pub mod security;
pub mod status;
pub mod title;
pub mod window;
pub mod auth;
pub mod settings;
pub mod share;
pub mod segments;
pub mod vaulttube;