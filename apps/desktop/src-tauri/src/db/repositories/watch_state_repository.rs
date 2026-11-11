//! Statuts de visionnage « À voir / En cours / Vu » (migration 0028) — PAR PROFIL.
//!
//! Seul endroit du code autorisé à écrire du SQL pour `media_watch_status`.
//! L'absence de ligne = « À voir » : ce module ne renvoie donc `todo` que par
//! défaut, jamais depuis la base.

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::Serialize;

use super::segment_repository;

pub const STATUS_TODO: &str = "todo";
pub const STATUS_IN_PROGRESS: &str = "in_progress";
pub const STATUS_DONE: &str = "done";

/// Ce que l'on sait d'un fichier média au moment d'évaluer sa progression.
#[derive(Debug, Clone, Copy)]
pub struct MediaContext {
    /// Le fichier appartient à un titre (film) ou à un épisode — les fichiers
    /// « libres » (musique, etc.) n'ont pas de statut de visionnage.
    pub has_title: bool,
    /// Début du générique de fin (segment `outro`) de l'épisode, s'il est connu.
    pub outro_start: Option<f64>,
}

pub fn media_context(conn: &Connection, media_file_id: i64) -> rusqlite::Result<Option<MediaContext>> {
    // La table des segments est créée à la demande (pas de migration numérotée).
    segment_repository::ensure_table(conn)?;
    conn.query_row(
        "SELECT COALESCE(m.title_id, e.title_id) IS NOT NULL,
                (SELECT s.start_seconds FROM episode_segments s
                  WHERE s.episode_id = m.episode_id AND s.segment_type = 'outro')
         FROM media_files m
         LEFT JOIN episodes e ON e.id = m.episode_id
         WHERE m.id = ?1",
        params![media_file_id],
        |row| {
            Ok(MediaContext {
                has_title: row.get::<_, i64>(0)? != 0,
                outro_start: row.get(1)?,
            })
        },
    )
    .optional()
}

/// Statut stocké (`in_progress` | `done`) d'un média, `None` = « À voir ».
pub fn get_status(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT status FROM media_watch_status WHERE profile_id = ?1 AND media_file_id = ?2",
        params![profile_id, media_file_id],
        |row| row.get(0),
    )
    .optional()
}

/// Passe un média à « En cours » — sans JAMAIS faire reculer un « Vu » (revoir
/// un film à moitié ne le rend pas « non vu »). Renvoie `true` si le statut a
/// réellement changé (nouvelle ligne), `false` sinon.
pub fn mark_in_progress(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
) -> rusqlite::Result<bool> {
    let now = chrono::Utc::now().to_rfc3339();
    let existing = get_status(conn, profile_id, media_file_id)?;
    match existing.as_deref() {
        Some(STATUS_DONE) => Ok(false),
        Some(_) => {
            // Déjà « En cours » : on rafraîchit seulement la date (ordre de reprise).
            conn.execute(
                "UPDATE media_watch_status SET updated_at = ?3
                 WHERE profile_id = ?1 AND media_file_id = ?2",
                params![profile_id, media_file_id, now],
            )?;
            Ok(false)
        }
        None => {
            conn.execute(
                "INSERT INTO media_watch_status (profile_id, media_file_id, status, completed_by, updated_at)
                 VALUES (?1, ?2, 'in_progress', NULL, ?3)",
                params![profile_id, media_file_id, now],
            )?;
            Ok(true)
        }
    }
}

/// Passe un média à « Vu ». Renvoie `true` si le statut a changé.
pub fn mark_done(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
    completed_by: &str,
) -> rusqlite::Result<bool> {
    // Déjà « Vu » : on ne réécrit rien (ni la raison, ni la date — la date sert
    // à proposer l'épisode SUIVANT le dernier terminé, un revisionnage ne doit
    // pas la déplacer).
    if get_status(conn, profile_id, media_file_id)?.as_deref() == Some(STATUS_DONE) {
        return Ok(false);
    }
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO media_watch_status (profile_id, media_file_id, status, completed_by, updated_at)
         VALUES (?1, ?2, 'done', ?3, ?4)
         ON CONFLICT(profile_id, media_file_id) DO UPDATE SET
            status = 'done',
            completed_by = excluded.completed_by,
            updated_at = excluded.updated_at",
        params![profile_id, media_file_id, completed_by, now],
    )?;
    Ok(true)
}

/// Marquage manuel « Vu » : écrase aussi un « Vu » automatique (la raison
/// devient `manual`), sans toucher à la date si le média l'était déjà.
pub fn mark_done_manual(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
) -> rusqlite::Result<bool> {
    let changed = mark_done(conn, profile_id, media_file_id, "manual")?;
    if !changed {
        conn.execute(
            "UPDATE media_watch_status SET completed_by = 'manual'
             WHERE profile_id = ?1 AND media_file_id = ?2",
            params![profile_id, media_file_id],
        )?;
    }
    Ok(changed)
}

/// Remet un média à « À voir » (supprime la ligne).
pub fn clear_status(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "DELETE FROM media_watch_status WHERE profile_id = ?1 AND media_file_id = ?2",
        params![profile_id, media_file_id],
    )?;
    Ok(n > 0)
}

/// Titre auquel appartient un fichier (film : `media_files.title_id` ; épisode :
/// via `episodes.title_id`).
pub fn title_of_media(conn: &Connection, media_file_id: i64) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT COALESCE(m.title_id, e.title_id)
         FROM media_files m LEFT JOIN episodes e ON e.id = m.episode_id
         WHERE m.id = ?1",
        params![media_file_id],
        |row| row.get::<_, Option<i64>>(0),
    )
    .optional()
    .map(|o| o.flatten())
}

/// Tous les fichiers disponibles d'un titre (un film, ou tous ses épisodes).
pub fn media_ids_of_title(conn: &Connection, title_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT m.id FROM media_files m WHERE m.is_available = 1 AND m.title_id = ?1
         UNION
         SELECT m.id FROM media_files m JOIN episodes e ON e.id = m.episode_id
          WHERE m.is_available = 1 AND e.title_id = ?1",
    )?;
    let rows = stmt.query_map(params![title_id], |row| row.get::<_, i64>(0))?;
    rows.collect()
}

// ---- Lecture groupée -----------------------------------------------------

/// Statut + avancement d'un fichier (pour les listes d'épisodes, pages de titre).
#[derive(Debug, Clone, Serialize)]
pub struct MediaWatchRow {
    pub media_file_id: i64,
    pub status: String,
    /// Fraction 0–1 de la position de reprise (seulement si « En cours »).
    pub progress_ratio: Option<f64>,
    pub position_seconds: Option<f64>,
}

fn placeholders(from: usize, count: usize) -> String {
    (from..from + count).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",")
}

/// Statuts de PLUSIEURS fichiers en une requête. Tous les ids demandés sont
/// renvoyés (« À voir » par défaut).
pub fn media_states(
    conn: &Connection,
    profile_id: i64,
    media_file_ids: &[i64],
) -> rusqlite::Result<Vec<MediaWatchRow>> {
    if media_file_ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        "SELECT m.id, w.status, p.position_seconds, p.duration_seconds
         FROM media_files m
         LEFT JOIN media_watch_status w ON w.media_file_id = m.id AND w.profile_id = ?1
         LEFT JOIN playback_progress p ON p.media_file_id = m.id AND p.profile_id = ?1
         WHERE m.id IN ({})",
        placeholders(2, media_file_ids.len())
    );
    let mut stmt = conn.prepare(&sql)?;
    let args = std::iter::once(profile_id).chain(media_file_ids.iter().copied());
    let rows = stmt.query_map(params_from_iter(args), |row| {
        let status: Option<String> = row.get(1)?;
        let position: Option<f64> = row.get(2)?;
        let duration: Option<f64> = row.get(3)?;
        let status = status.unwrap_or_else(|| STATUS_TODO.to_string());
        let (ratio, pos) = match (status.as_str(), position, duration) {
            (STATUS_IN_PROGRESS, Some(p), Some(d)) if d > 0.0 => {
                (Some((p / d).clamp(0.0, 1.0)), Some(p))
            }
            _ => (None, None),
        };
        Ok(MediaWatchRow {
            media_file_id: row.get(0)?,
            status,
            progress_ratio: ratio,
            position_seconds: pos,
        })
    })?;
    rows.collect()
}

/// Décomptes par titre, à partir desquels le domaine déduit le statut d'un titre.
#[derive(Debug, Clone)]
pub struct TitleCounts {
    pub title_id: i64,
    pub kind: String,
    pub total: i64,
    pub done: i64,
    pub in_progress: i64,
}

pub fn title_counts(
    conn: &Connection,
    profile_id: i64,
    title_ids: &[i64],
) -> rusqlite::Result<Vec<TitleCounts>> {
    if title_ids.is_empty() {
        return Ok(Vec::new());
    }
    let ids = placeholders(2, title_ids.len());
    // Films (`media_files.title_id`) et épisodes (`episodes.title_id`) : deux
    // requêtes indexées réunies par UNION (dédoublonne un fichier éventuellement
    // rattaché des deux façons), plutôt qu'un OR qui interdirait les index.
    let sql = format!(
        "WITH tm AS (
            SELECT m.title_id AS tid, m.id AS mid FROM media_files m
             WHERE m.is_available = 1 AND m.title_id IN ({ids})
            UNION
            SELECT e.title_id AS tid, m.id AS mid FROM media_files m
              JOIN episodes e ON e.id = m.episode_id
             WHERE m.is_available = 1 AND e.title_id IN ({ids})
         )
         SELECT t.id, t.kind, COUNT(tm.mid),
                COALESCE(SUM(CASE WHEN w.status = 'done' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN w.status = 'in_progress' THEN 1 ELSE 0 END), 0)
         FROM titles t
         JOIN tm ON tm.tid = t.id
         LEFT JOIN media_watch_status w ON w.media_file_id = tm.mid AND w.profile_id = ?1
         WHERE t.id IN ({ids})
         GROUP BY t.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let args = std::iter::once(profile_id).chain(title_ids.iter().copied());
    let rows = stmt.query_map(params_from_iter(args), |row| {
        Ok(TitleCounts {
            title_id: row.get(0)?,
            kind: row.get(1)?,
            total: row.get(2)?,
            done: row.get(3)?,
            in_progress: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// Un épisode d'une série avec son statut, dans l'ordre de lecture.
#[derive(Debug, Clone, Serialize)]
pub struct EpisodeRow {
    pub media_file_id: i64,
    pub episode_id: i64,
    pub season_id: i64,
    pub season_number: i64,
    pub episode_number: i64,
    pub status: String,
    pub updated_at: Option<String>,
    pub position_seconds: Option<f64>,
}

pub fn episode_rows(
    conn: &Connection,
    profile_id: i64,
    title_id: i64,
) -> rusqlite::Result<Vec<EpisodeRow>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, e.id, s.id, s.season_number, e.episode_number,
                COALESCE(w.status, 'todo'), w.updated_at, p.position_seconds
         FROM media_files m
         JOIN episodes e ON e.id = m.episode_id
         JOIN seasons s ON s.id = e.season_id
         LEFT JOIN media_watch_status w ON w.media_file_id = m.id AND w.profile_id = ?1
         LEFT JOIN playback_progress p ON p.media_file_id = m.id AND p.profile_id = ?1
         WHERE m.is_available = 1 AND e.title_id = ?2
         ORDER BY s.season_number, e.episode_number",
    )?;
    let rows = stmt.query_map(params![profile_id, title_id], |row| {
        Ok(EpisodeRow {
            media_file_id: row.get(0)?,
            episode_id: row.get(1)?,
            season_id: row.get(2)?,
            season_number: row.get(3)?,
            episode_number: row.get(4)?,
            status: row.get(5)?,
            updated_at: row.get(6)?,
            position_seconds: row.get(7)?,
        })
    })?;
    rows.collect()
}

/// Reflète le statut AUTOMATIQUE d'un titre dans sa ligne de watchlist, SI le
/// titre y figure (la watchlist reste une liste que l'utilisateur alimente : on
/// n'y ajoute rien, on ne fait que garder son statut cohérent).
pub fn mirror_into_watchlist(
    conn: &Connection,
    profile_id: i64,
    title_id: i64,
    status: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE watchlist_items SET status = ?3, updated_at = datetime('now')
         WHERE profile_id = ?1 AND title_id = ?2 AND status != ?3",
        params![profile_id, title_id, status],
    )?;
    Ok(())
}
