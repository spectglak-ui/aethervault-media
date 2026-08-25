//! Playback Session Manager (partie persistance) : règles autour de la
//! progression de lecture, indépendantes du moteur de rendu.
//!
//! Ne gère pas la lecture elle-même (ça, c'est le rôle du moteur — HTML5 en
//! 3a, libmpv en 3b, entièrement côté frontend pour l'instant) : uniquement
//! le fait de se souvenir où en était l'utilisateur.
//!
//! Depuis l'Étape 6a (doc §6.5), la progression est scopée par profil :
//! `profile_id` est toujours celui du profil actif (`state::AppState`),
//! jamais un identifiant transmis par le frontend — voir
//! `commands::playback`.

use crate::db::repositories::playback_repository::{self, PlaybackProgressRecord};
use crate::db::DbPool;

/// Fraction de la durée totale au-delà de laquelle un fichier est considéré
/// "terminé" plutôt que "en cours" — évite qu'un futur "Continuer la
/// lecture" (Étape 7) affiche un fichier regardé jusqu'au bout.
const COMPLETED_THRESHOLD: f64 = 0.95;

pub fn get_progress(
    pool: &DbPool,
    profile_id: i64,
    media_file_id: i64,
) -> Result<Option<PlaybackProgressRecord>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    playback_repository::get(&conn, profile_id, media_file_id).map_err(|e| e.to_string())
}

pub fn save_progress(
    pool: &DbPool,
    profile_id: i64,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let is_completed = duration_seconds > 0.0 && position_seconds / duration_seconds >= COMPLETED_THRESHOLD;

    if is_completed {
        playback_repository::clear(&conn, profile_id, media_file_id).map_err(|e| e.to_string())
    } else {
        playback_repository::upsert(&conn, profile_id, media_file_id, position_seconds, duration_seconds)
            .map_err(|e| e.to_string())
    }
}
