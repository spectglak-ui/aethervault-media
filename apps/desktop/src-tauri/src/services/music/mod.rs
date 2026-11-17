//! AetherFy Musique (0.7.9) : recherche musicale précise et résolution de lecture.
//!
//! Trois briques indépendantes :
//! - **catalogue** (`musicbrainz`) : artistes, albums et titres structurés, via
//!   l'API publique de MusicBrainz (données ouvertes, sans clé, gratuite pour un
//!   usage non commercial). Choisie plutôt que Deezer dont les conditions
//!   d'utilisation limitent l'API aux « applications personnelles » et interdisent
//!   de l'associer à de la lecture non autorisée — incompatible avec un logiciel
//!   public qui lit via YouTube ;
//! - **résolveur** (`resolver`) : retrouve sur YouTube la bonne version audio d'un
//!   titre du catalogue (titre, artiste, durée) et mémorise le choix ;
//! - **web** (`web`) : recherche de playlists YouTube et de livres audio.

pub mod models;
pub mod musicbrainz;
pub mod ranking;
pub mod resolver;
pub mod text;
pub mod web;
