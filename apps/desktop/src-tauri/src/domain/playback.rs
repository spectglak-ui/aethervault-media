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
use rusqlite::OptionalExtension;

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

// ---- Historique de visionnage (Étape 8) --------------------------------

/// Enregistre une session dans `watch_history` et récupère les infos
/// nécessaires (titre, catégorie) depuis la jointure media_files→titres.
pub fn record_watch_session(
    pool: &DbPool,
    profile_id: i64,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let (title_id, kind, category_key): (i64, String, String) = conn
        .query_row(
            "SELECT COALESCE(t.id, et.id),
                    COALESCE(t.kind, et.kind),
                    c.key
             FROM media_files m
             LEFT JOIN titles t ON t.id = m.title_id
             LEFT JOIN episodes e ON e.id = m.episode_id
             LEFT JOIN titles et ON et.id = e.title_id
             JOIN categories c ON c.id = COALESCE(t.category_id, et.category_id)
             WHERE m.id = ?1 AND COALESCE(t.id, et.id) IS NOT NULL",
            rusqlite::params![media_file_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Titre introuvable pour cette session".to_string())?;
    crate::db::repositories::playback_repository::record_watch(
        &conn,
        profile_id,
        media_file_id,
        title_id,
        &kind,
        &category_key,
        position_seconds,
        duration_seconds,
    )
    .map_err(|e| e.to_string())
}