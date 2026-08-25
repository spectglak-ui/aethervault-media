//! Services techniques utilisés par la couche métier : accès au système de
//! fichiers, moteur de lecture, etc. — tout ce qui dépasse une simple
//! lecture/écriture en base.

pub mod image_store;
pub mod metadata;
pub mod playback_engine;
pub mod private_image_scanner;
pub mod private_video_scanner;
pub mod scanner;
pub mod watcher;
