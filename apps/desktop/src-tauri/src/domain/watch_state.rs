//! Statuts de visionnage « À voir / En cours / Vu » (0.7.9) — règles métier.
//!
//! Trois états par fichier média et par profil :
//! - **À voir**   : état initial de TOUS les médias (absence de ligne en base) ;
//! - **En cours** : commencé (≥ 30 s et ≥ 1 %) mais pas terminé — un clic
//!   reprend la lecture à la position sauvegardée (`playback_progress`) ;
//! - **Vu**       : terminé, au sens large décrit ci-dessous.
//!
//! ## Quand un média est-il « Vu » ?
//! Jamais « à 95 % » aveuglément : le générique de fin ne démarre pas au même
//! endroit selon la durée. Ordre des règles (la première qui s'applique gagne) :
//! 1. **Fin du fichier** atteinte (à 1,5 s près) → `ended`.
//! 2. **Générique détecté** (segment `outro` d'un épisode, voir
//!    `commands::segments`) : « Vu » dès `début du générique − 15 s` — arrêter
//!    quelques secondes AVANT le générique compte, pendant ou après aussi
//!    → `credits`. Un générique « détecté » avant 60 % de la durée est
//!    considéré comme une fausse détection et ignoré.
//! 3. **Queue de secours** quand le générique est inconnu (films, séries non
//!    analysées) : les derniers 5 % de la durée, bornés entre 45 s et 6 min
//!    (et jamais plus du quart du média) → `tail`.
//!
//! Le statut ne RECULE JAMAIS tout seul : revoir un film à moitié le laisse
//! « Vu » (la position de reprise, elle, est bien mémorisée). Seule une action
//! manuelle (« Marquer comme non vu ») remet un média à « À voir ».

use crate::db::repositories::watch_state_repository::{
    self as repo, EpisodeRow, STATUS_DONE, STATUS_IN_PROGRESS, STATUS_TODO,
};
use rusqlite::Connection;
use serde::Serialize;

/// Marge avant le début du générique : s'arrêter jusqu'à 15 s AVANT compte.
pub const CREDITS_TOLERANCE_SECONDS: f64 = 15.0;
/// Fin du fichier : à moins de 1,5 s de la durée, c'est terminé.
pub const END_REACHED_MARGIN_SECONDS: f64 = 1.5;
/// Queue de secours (générique inconnu) : 5 % de la durée…
pub const TAIL_RATIO: f64 = 0.05;
/// …mais au moins 45 s…
pub const TAIL_MIN_SECONDS: f64 = 45.0;
/// …et au plus 6 min (un documentaire de 4 h n'a pas 12 min de générique).
pub const TAIL_MAX_SECONDS: f64 = 360.0;
/// Garde-fou pour les très courts médias : la queue ne dépasse jamais 25 %.
pub const TAIL_MAX_SHARE_OF_MEDIA: f64 = 0.25;
/// Un générique détecté avant 60 % de la durée est jugé invraisemblable.
pub const OUTRO_MIN_START_RATIO: f64 = 0.60;
/// « En cours » : au moins 30 s de lecture ET au moins 1 % de la durée
/// (un clic accidentel ou un aperçu de quelques secondes ne change rien).
pub const IN_PROGRESS_MIN_SECONDS: f64 = 30.0;
pub const IN_PROGRESS_MIN_RATIO: f64 = 0.01;
/// Médias sans titre (musique…) : l'ancienne règle des 95 % est conservée.
pub const LEGACY_COMPLETED_RATIO: f64 = 0.95;

/// Pourquoi un média est considéré « Vu » (stocké dans `completed_by`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletedBy {
    Ended,
    Credits,
    Tail,
}

impl CompletedBy {
    pub fn as_str(self) -> &'static str {
        match self {
            CompletedBy::Ended => "ended",
            CompletedBy::Credits => "credits",
            CompletedBy::Tail => "tail",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Trop peu regardé pour compter : le statut ne change pas.
    NotStarted,
    InProgress,
    Completed(CompletedBy),
}

/// Durée de la queue de secours pour un média de `duration` secondes.
pub fn tail_seconds(duration: f64) -> f64 {
    (duration * TAIL_RATIO)
        .clamp(TAIL_MIN_SECONDS, TAIL_MAX_SECONDS)
        .min(duration * TAIL_MAX_SHARE_OF_MEDIA)
}

/// Début de générique exploitable (cohérent avec la durée), sinon `None`.
pub fn plausible_outro_start(duration: f64, outro_start: Option<f64>) -> Option<f64> {
    outro_start.filter(|s| s.is_finite() && *s >= duration * OUTRO_MIN_START_RATIO && *s < duration)
}

/// Position à partir de laquelle le média est « Vu », et la règle responsable.
pub fn completion_point(duration: f64, outro_start: Option<f64>) -> (f64, CompletedBy) {
    let tail_point = duration - tail_seconds(duration);
    match plausible_outro_start(duration, outro_start) {
        Some(start) => {
            let credits_point = (start - CREDITS_TOLERANCE_SECONDS).max(0.0);
            // Un générique détecté très tard ne doit jamais rendre le seuil
            // plus exigeant que la queue de secours.
            if credits_point < tail_point {
                (credits_point, CompletedBy::Credits)
            } else {
                (tail_point, CompletedBy::Tail)
            }
        }
        None => (tail_point, CompletedBy::Tail),
    }
}

/// Verdict pour une position donnée (fonction pure, entièrement testée).
pub fn evaluate(position: f64, duration: f64, outro_start: Option<f64>) -> Verdict {
    if !(duration.is_finite() && duration > 0.0) || !position.is_finite() {
        return Verdict::NotStarted;
    }
    let position = position.max(0.0);
    if position >= duration - END_REACHED_MARGIN_SECONDS {
        return Verdict::Completed(CompletedBy::Ended);
    }
    let (point, by) = completion_point(duration, outro_start);
    if position >= point {
        return Verdict::Completed(by);
    }
    if position >= IN_PROGRESS_MIN_SECONDS && position / duration >= IN_PROGRESS_MIN_RATIO {
        return Verdict::InProgress;
    }
    Verdict::NotStarted
}

/// Ancienne règle (≥ 95 %) pour les fichiers sans titre.
pub fn legacy_verdict(position: f64, duration: f64) -> Verdict {
    if duration > 0.0 && position / duration >= LEGACY_COMPLETED_RATIO {
        Verdict::Completed(CompletedBy::Tail)
    } else {
        Verdict::NotStarted
    }
}

/// Statut d'un TITRE à partir de ses fichiers :
/// - film : « Vu » dès qu'un fichier l'est (plusieurs versions du même film) ;
/// - série : « Vu » si TOUS les épisodes le sont, « En cours » dès qu'un
///   épisode est commencé ou terminé, « À voir » sinon.
pub fn title_status(kind: &str, total: i64, done: i64, in_progress: i64) -> &'static str {
    if total <= 0 {
        return STATUS_TODO;
    }
    if kind == "movie" {
        if done > 0 {
            STATUS_DONE
        } else if in_progress > 0 {
            STATUS_IN_PROGRESS
        } else {
            STATUS_TODO
        }
    } else if done >= total {
        STATUS_DONE
    } else if done > 0 || in_progress > 0 {
        STATUS_IN_PROGRESS
    } else {
        STATUS_TODO
    }
}

/// Quel épisode proposer à « Continuer » ? (index dans `rows`, ordonnées par
/// saison puis épisode)
/// 1. l'épisode commencé le plus récemment ;
/// 2. sinon l'épisode non vu qui SUIT le dernier épisode terminé ;
/// 3. sinon le premier épisode non vu ; `None` si tout est vu.
pub fn pick_resume_target(rows: &[EpisodeRow]) -> Option<usize> {
    let latest = |status: &str| {
        rows.iter()
            .enumerate()
            .filter(|(_, r)| r.status == status)
            .max_by(|a, b| a.1.updated_at.cmp(&b.1.updated_at))
            .map(|(i, _)| i)
    };
    if let Some(i) = latest(STATUS_IN_PROGRESS) {
        return Some(i);
    }
    if let Some(done) = latest(STATUS_DONE) {
        if let Some(next) = (done + 1..rows.len()).find(|&j| rows[j].status != STATUS_DONE) {
            return Some(next);
        }
    }
    rows.iter().position(|r| r.status != STATUS_DONE)
}

// ---- Orchestration (SQL via le dépôt) ---------------------------------------

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// Statut d'un titre pour le profil, avec les compteurs d'épisodes vus.
#[derive(Debug, Clone, Serialize)]
pub struct TitleWatchState {
    pub title_id: i64,
    pub status: String,
    pub watched: i64,
    pub total: i64,
}

/// Statut de plusieurs titres en une requête ; TOUS les ids demandés sont
/// renvoyés (« À voir » pour un titre sans fichier ni historique).
pub fn title_states(
    conn: &Connection,
    profile_id: i64,
    title_ids: &[i64],
) -> Result<Vec<TitleWatchState>, String> {
    let counts = repo::title_counts(conn, profile_id, title_ids).map_err(err)?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(title_ids.len());
    for id in title_ids {
        if !seen.insert(*id) {
            continue;
        }
        out.push(match counts.iter().find(|c| c.title_id == *id) {
            Some(c) => TitleWatchState {
                title_id: *id,
                status: title_status(&c.kind, c.total, c.done, c.in_progress).to_string(),
                watched: c.done,
                total: c.total,
            },
            None => TitleWatchState {
                title_id: *id,
                status: STATUS_TODO.to_string(),
                watched: 0,
                total: 0,
            },
        });
    }
    Ok(out)
}

/// Garde la ligne de watchlist du titre (s'il y figure) alignée sur son statut.
fn sync_watchlist(conn: &Connection, profile_id: i64, title_id: i64) -> Result<(), String> {
    if let Some(state) = title_states(conn, profile_id, &[title_id])?.first() {
        // Titre sans fichier disponible : rien à refléter (son statut « À voir »
        // n'est qu'un défaut, pas une information).
        if state.total > 0 {
            repo::mirror_into_watchlist(conn, profile_id, title_id, &state.status).map_err(err)?;
        }
    }
    Ok(())
}

/// Appelé à chaque sauvegarde de progression (toutes les 5 s en lecture, à
/// l'arrêt et à la fin). Met le statut à jour et renvoie le verdict : le
/// domaine `playback` en déduit s'il faut conserver ou effacer la position.
pub fn record_progress(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> Result<Verdict, String> {
    let context = repo::media_context(conn, media_file_id).map_err(err)?;
    let Some(context) = context.filter(|c| c.has_title) else {
        return Ok(legacy_verdict(position_seconds, duration_seconds));
    };
    let verdict = evaluate(position_seconds, duration_seconds, context.outro_start);
    let changed = match verdict {
        Verdict::Completed(by) => {
            repo::mark_done(conn, profile_id, media_file_id, by.as_str()).map_err(err)?
        }
        Verdict::InProgress => repo::mark_in_progress(conn, profile_id, media_file_id).map_err(err)?,
        Verdict::NotStarted => false,
    };
    if changed {
        if let Some(title_id) = repo::title_of_media(conn, media_file_id).map_err(err)? {
            sync_watchlist(conn, profile_id, title_id)?;
        }
    }
    Ok(verdict)
}

/// Marquage manuel d'un fichier : `done` ou `todo` (remise à « À voir », qui
/// efface aussi la position de reprise).
pub fn set_media_status(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
    status: &str,
) -> Result<(), String> {
    apply_manual(conn, profile_id, media_file_id, status)?;
    if let Some(title_id) = repo::title_of_media(conn, media_file_id).map_err(err)? {
        sync_watchlist(conn, profile_id, title_id)?;
    }
    Ok(())
}

fn apply_manual(
    conn: &Connection,
    profile_id: i64,
    media_file_id: i64,
    status: &str,
) -> Result<(), String> {
    use crate::db::repositories::playback_repository;
    match status {
        STATUS_DONE => {
            repo::mark_done_manual(conn, profile_id, media_file_id).map_err(err)?;
        }
        STATUS_TODO => {
            repo::clear_status(conn, profile_id, media_file_id).map_err(err)?;
        }
        other => return Err(format!("Statut de visionnage inconnu : {other}")),
    }
    // Dans les deux cas la position de reprise n'a plus de sens (vu en entier,
    // ou remis à zéro) : le prochain clic repart du début.
    playback_repository::clear(conn, profile_id, media_file_id).map_err(err)
}

/// Marquage manuel d'un TITRE entier (tous ses épisodes, ou son film).
pub fn set_title_status(
    conn: &Connection,
    profile_id: i64,
    title_id: i64,
    status: &str,
) -> Result<(), String> {
    if status != STATUS_DONE && status != STATUS_TODO {
        return Err(format!("Statut de visionnage inconnu : {status}"));
    }
    let ids = repo::media_ids_of_title(conn, title_id).map_err(err)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    for id in ids {
        apply_manual(&tx, profile_id, id, status)?;
    }
    tx.commit().map_err(err)?;
    sync_watchlist(conn, profile_id, title_id)
}

/// Épisode à proposer pour « Continuer » une série.
#[derive(Debug, Clone, Serialize)]
pub struct ResumeTarget {
    pub media_file_id: i64,
    pub episode_id: i64,
    pub season_id: i64,
    pub season_number: i64,
    pub episode_number: i64,
    pub status: String,
    /// Position de reprise (secondes) si l'épisode est « En cours ».
    pub resume_seconds: Option<f64>,
}

pub fn resume_target(
    conn: &Connection,
    profile_id: i64,
    title_id: i64,
) -> Result<Option<ResumeTarget>, String> {
    let rows = repo::episode_rows(conn, profile_id, title_id).map_err(err)?;
    Ok(pick_resume_target(&rows).map(|i| {
        let r = &rows[i];
        ResumeTarget {
            media_file_id: r.media_file_id,
            episode_id: r.episode_id,
            season_id: r.season_id,
            season_number: r.season_number,
            episode_number: r.episode_number,
            status: r.status.clone(),
            resume_seconds: if r.status == STATUS_IN_PROGRESS { r.position_seconds } else { None },
        }
    }))
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::MIGRATIONS;

    // ---- Règles pures ---------------------------------------------------

    const FILM: f64 = 7200.0; // 2 h
    const EPISODE: f64 = 1500.0; // 25 min

    #[test]
    fn film_sans_generique_connu_utilise_la_queue_de_secours_plafonnee() {
        // 5 % de 2 h = 6 min = plafond → seuil à 6840 s.
        assert_eq!(tail_seconds(FILM), 360.0);
        assert_eq!(evaluate(6839.0, FILM, None), Verdict::InProgress);
        assert_eq!(evaluate(6840.0, FILM, None), Verdict::Completed(CompletedBy::Tail));
        assert_eq!(evaluate(7199.0, FILM, None), Verdict::Completed(CompletedBy::Ended));
    }

    #[test]
    fn episode_court_a_une_queue_proportionnelle() {
        // 5 % de 25 min = 75 s → seuil à 1425 s.
        assert_eq!(tail_seconds(EPISODE), 75.0);
        assert_eq!(evaluate(1424.0, EPISODE, None), Verdict::InProgress);
        assert_eq!(evaluate(1425.0, EPISODE, None), Verdict::Completed(CompletedBy::Tail));
    }

    #[test]
    fn tres_long_media_ne_compte_pas_5_pour_cent_de_generique() {
        // Documentaire de 4 h : 5 % = 12 min, plafonné à 6 min.
        assert_eq!(tail_seconds(4.0 * 3600.0), TAIL_MAX_SECONDS);
    }

    #[test]
    fn arret_quelques_secondes_avant_le_generique_compte_comme_vu() {
        // Générique à 1400 s → « Vu » dès 1385 s (15 s avant).
        let outro = Some(1400.0);
        assert_eq!(evaluate(1384.0, EPISODE, outro), Verdict::InProgress);
        assert_eq!(evaluate(1385.0, EPISODE, outro), Verdict::Completed(CompletedBy::Credits));
        // Pendant et après le générique : toujours « Vu ».
        assert_eq!(evaluate(1400.0, EPISODE, outro), Verdict::Completed(CompletedBy::Credits));
        assert_eq!(evaluate(1460.0, EPISODE, outro), Verdict::Completed(CompletedBy::Credits));
    }

    #[test]
    fn faux_generique_trop_tot_est_ignore() {
        // Détecté à 40 % de la durée : invraisemblable → on retombe sur la queue.
        assert_eq!(plausible_outro_start(EPISODE, Some(600.0)), None);
        assert_eq!(evaluate(900.0, EPISODE, Some(600.0)), Verdict::InProgress);
        assert_eq!(evaluate(1425.0, EPISODE, Some(600.0)), Verdict::Completed(CompletedBy::Tail));
    }

    #[test]
    fn generique_detecte_tres_tard_ne_rend_pas_le_seuil_plus_exigeant() {
        // Générique à 1490 s → 1475 s, mais la queue de secours (1425 s) passe avant.
        assert_eq!(evaluate(1430.0, EPISODE, Some(1490.0)), Verdict::Completed(CompletedBy::Tail));
    }

    #[test]
    fn en_cours_demande_30_secondes_et_1_pour_cent() {
        // Film de 2 h : 1 % = 72 s.
        assert_eq!(evaluate(10.0, FILM, None), Verdict::NotStarted);
        assert_eq!(evaluate(31.0, FILM, None), Verdict::NotStarted);
        assert_eq!(evaluate(80.0, FILM, None), Verdict::InProgress);
        // Épisode de 25 min : 1 % = 15 s, donc 30 s suffisent.
        assert_eq!(evaluate(29.0, EPISODE, None), Verdict::NotStarted);
        assert_eq!(evaluate(30.0, EPISODE, None), Verdict::InProgress);
    }

    #[test]
    fn mesures_invalides_ne_changent_rien() {
        assert_eq!(evaluate(100.0, 0.0, None), Verdict::NotStarted);
        assert_eq!(evaluate(f64::NAN, EPISODE, None), Verdict::NotStarted);
        assert_eq!(evaluate(100.0, f64::INFINITY, None), Verdict::NotStarted);
        assert_eq!(evaluate(-5.0, EPISODE, None), Verdict::NotStarted);
    }

    #[test]
    fn tres_court_media_reste_utilisable() {
        // Clip de 40 s : queue = 10 s (25 % max) → « Vu » à partir de 30 s.
        assert_eq!(tail_seconds(40.0), 10.0);
        assert_eq!(evaluate(29.0, 40.0, None), Verdict::NotStarted);
        assert_eq!(evaluate(30.0, 40.0, None), Verdict::Completed(CompletedBy::Tail));
    }

    #[test]
    fn ancienne_regle_95_pour_cent_pour_les_fichiers_sans_titre() {
        assert_eq!(legacy_verdict(94.0, 100.0), Verdict::NotStarted);
        assert_eq!(legacy_verdict(95.0, 100.0), Verdict::Completed(CompletedBy::Tail));
    }

    #[test]
    fn statut_de_titre() {
        assert_eq!(title_status("movie", 0, 0, 0), "todo");
        assert_eq!(title_status("movie", 1, 0, 0), "todo");
        assert_eq!(title_status("movie", 1, 0, 1), "in_progress");
        assert_eq!(title_status("movie", 1, 1, 0), "done");
        assert_eq!(title_status("series", 10, 0, 0), "todo");
        assert_eq!(title_status("series", 10, 0, 1), "in_progress");
        assert_eq!(title_status("series", 10, 3, 0), "in_progress"); // entre deux épisodes
        assert_eq!(title_status("series", 10, 9, 0), "in_progress");
        assert_eq!(title_status("series", 10, 10, 0), "done");
    }

    fn row(season: i64, ep: i64, status: &str, at: Option<&str>) -> EpisodeRow {
        EpisodeRow {
            media_file_id: season * 100 + ep,
            episode_id: season * 100 + ep,
            season_id: season,
            season_number: season,
            episode_number: ep,
            status: status.to_string(),
            updated_at: at.map(str::to_string),
            position_seconds: None,
        }
    }

    #[test]
    fn continuer_propose_l_episode_en_cours() {
        let rows = vec![
            row(1, 1, "done", Some("2026-11-01")),
            row(1, 2, "in_progress", Some("2026-11-05")),
            row(1, 3, "todo", None),
        ];
        assert_eq!(pick_resume_target(&rows), Some(1));
    }

    #[test]
    fn continuer_propose_l_episode_suivant_le_dernier_termine() {
        // L'utilisateur a sauté à l'épisode 5 puis l'a fini : on propose le 6,
        // pas le 3 resté non vu.
        let rows = vec![
            row(1, 1, "done", Some("2026-11-01")),
            row(1, 2, "done", Some("2026-11-02")),
            row(1, 3, "todo", None),
            row(1, 4, "todo", None),
            row(1, 5, "done", Some("2026-11-08")),
            row(1, 6, "todo", None),
        ];
        assert_eq!(pick_resume_target(&rows), Some(5));
    }

    #[test]
    fn continuer_retombe_sur_le_premier_non_vu_puis_sur_rien() {
        let rows = vec![
            row(1, 1, "todo", None),
            row(1, 2, "done", Some("2026-11-02")),
        ];
        // Le dernier terminé est le dernier épisode : on revient au premier non vu.
        assert_eq!(pick_resume_target(&rows), Some(0));
        let all_done = vec![row(1, 1, "done", Some("a")), row(1, 2, "done", Some("b"))];
        assert_eq!(pick_resume_target(&all_done), None);
        assert_eq!(pick_resume_target(&[]), None);
        let fresh = vec![row(1, 1, "todo", None), row(1, 2, "todo", None)];
        assert_eq!(pick_resume_target(&fresh), Some(0));
    }

    // ---- Base de données réelle (toutes les migrations, SQLite en mémoire) ----

    const P: i64 = 1;

    /// Les tables VaultTube sont créées par le code du service (pas par une
    /// migration numérotée) mais les migrations 18 à 24 les modifient : on en
    /// pose des coquilles pour pouvoir rejouer toute la chaîne en test.
    fn open_with_legacy_tables() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             CREATE TABLE vaulttube_subscriptions (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_videos (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_playlists (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_user_playlists (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_user_playlist_items (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        conn
    }

    fn setup() -> Connection {
        let conn = open_with_legacy_tables();
        for m in MIGRATIONS {
            conn.execute_batch(m.sql)
                .unwrap_or_else(|e| panic!("migration {} : {e}", m.version));
        }
        conn
    }

    fn add_title(conn: &Connection, id: i64, kind: &str) {
        conn.execute(
            "INSERT INTO titles (id, category_id, kind, name, created_at, updated_at)
             VALUES (?1, 1, ?2, ?3, 'x', 'x')",
            rusqlite::params![id, kind, format!("Titre {id}")],
        )
        .unwrap();
    }

    fn add_file(conn: &Connection, id: i64, title_id: Option<i64>, episode_id: Option<i64>) {
        conn.execute(
            "INSERT INTO media_files (id, library_id, folder_id, path, file_name, size_bytes,
                                      modified_at, discovered_at, updated_at, title_id, episode_id)
             VALUES (?1, 1, 1, ?2, 'f', 1, 'x', 'x', 'x', ?3, ?4)",
            rusqlite::params![id, format!("/m/{id}.mkv"), title_id, episode_id],
        )
        .unwrap();
    }

    /// Série n°10 : saison 1, épisodes 1..=3 (fichiers 101..=103, épisodes 1..=3).
    fn add_series(conn: &Connection) {
        add_title(conn, 10, "series");
        conn.execute(
            "INSERT INTO seasons (id, title_id, season_number, created_at) VALUES (1, 10, 1, 'x')",
            [],
        )
        .unwrap();
        for n in 1..=3 {
            conn.execute(
                "INSERT INTO episodes (id, title_id, season_id, episode_number, created_at)
                 VALUES (?1, 10, 1, ?1, 'x')",
                [n],
            )
            .unwrap();
            add_file(conn, 100 + n, None, Some(n));
        }
    }

    fn status_of(conn: &Connection, file: i64) -> String {
        repo::media_states(conn, P, &[file]).unwrap()[0].status.clone()
    }

    #[test]
    fn tout_est_a_voir_au_depart() {
        let conn = setup();
        add_title(&conn, 1, "movie");
        add_file(&conn, 1, Some(1), None);
        add_series(&conn);
        assert_eq!(status_of(&conn, 1), "todo");
        let states = title_states(&conn, P, &[1, 10, 999]).unwrap();
        assert!(states.iter().all(|s| s.status == "todo"));
        assert_eq!(states[1].total, 3);
        assert_eq!(states[2].total, 0); // titre inconnu : « À voir » par défaut
    }

    #[test]
    fn film_a_voir_en_cours_vu() {
        let conn = setup();
        add_title(&conn, 1, "movie");
        add_file(&conn, 1, Some(1), None);

        // Quelques secondes : aucun changement.
        record_progress(&conn, P, 1, 12.0, FILM).unwrap();
        assert_eq!(status_of(&conn, 1), "todo");
        // 20 min : « En cours », avec progression exploitable pour la reprise.
        conn.execute(
            "INSERT INTO playback_progress VALUES (1, 1, 1200.0, 7200.0, 'x')",
            [],
        )
        .unwrap();
        record_progress(&conn, P, 1, 1200.0, FILM).unwrap();
        let rows = repo::media_states(&conn, P, &[1]).unwrap();
        assert_eq!(rows[0].status, "in_progress");
        assert!((rows[0].progress_ratio.unwrap() - 1200.0 / 7200.0).abs() < 1e-9);
        assert_eq!(title_states(&conn, P, &[1]).unwrap()[0].status, "in_progress");
        // Arrêt dans la queue : « Vu ».
        let v = record_progress(&conn, P, 1, 6900.0, FILM).unwrap();
        assert_eq!(v, Verdict::Completed(CompletedBy::Tail));
        assert_eq!(status_of(&conn, 1), "done");
        assert_eq!(title_states(&conn, P, &[1]).unwrap()[0].status, "done");
    }

    #[test]
    fn un_vu_ne_recule_jamais_tout_seul() {
        let conn = setup();
        add_title(&conn, 1, "movie");
        add_file(&conn, 1, Some(1), None);
        record_progress(&conn, P, 1, 7199.0, FILM).unwrap();
        assert_eq!(status_of(&conn, 1), "done");
        // Revoir 30 minutes ne le rend pas « En cours ».
        record_progress(&conn, P, 1, 1800.0, FILM).unwrap();
        assert_eq!(status_of(&conn, 1), "done");
    }

    #[test]
    fn generique_detecte_d_un_episode_est_utilise() {
        let conn = setup();
        add_series(&conn);
        crate::db::repositories::segment_repository::ensure_table(&conn).unwrap();
        crate::db::repositories::segment_repository::upsert(&conn, 1, "outro", 1400.0, 1500.0, "auto")
            .unwrap();
        // Épisode 1 : générique à 1400 s → « Vu » dès 1385 s ; épisode 2 : queue (1425 s).
        assert_eq!(record_progress(&conn, P, 101, 1380.0, EPISODE).unwrap(), Verdict::InProgress);
        assert_eq!(
            record_progress(&conn, P, 101, 1386.0, EPISODE).unwrap(),
            Verdict::Completed(CompletedBy::Credits)
        );
        assert_eq!(record_progress(&conn, P, 102, 1386.0, EPISODE).unwrap(), Verdict::InProgress);
    }

    #[test]
    fn statut_de_serie_et_reprise() {
        let conn = setup();
        add_series(&conn);
        record_progress(&conn, P, 101, 1499.0, EPISODE).unwrap(); // épisode 1 vu
        let s = &title_states(&conn, P, &[10]).unwrap()[0];
        assert_eq!((s.status.as_str(), s.watched, s.total), ("in_progress", 1, 3));
        // Aucun épisode en cours : on propose le suivant, l'épisode 2.
        let target = resume_target(&conn, P, 10).unwrap().unwrap();
        assert_eq!(target.episode_number, 2);
        assert_eq!(target.resume_seconds, None);
        // L'épisode 2 est commencé (position sauvegardée) : on propose de le reprendre.
        conn.execute("INSERT INTO playback_progress VALUES (1, 102, 600.0, 1500.0, 'x')", [])
            .unwrap();
        record_progress(&conn, P, 102, 600.0, EPISODE).unwrap();
        let target = resume_target(&conn, P, 10).unwrap().unwrap();
        assert_eq!(target.episode_number, 2);
        assert_eq!(target.resume_seconds, Some(600.0));
        // Tout vu → série « Vu », plus rien à proposer.
        record_progress(&conn, P, 102, 1499.0, EPISODE).unwrap();
        record_progress(&conn, P, 103, 1499.0, EPISODE).unwrap();
        assert_eq!(title_states(&conn, P, &[10]).unwrap()[0].status, "done");
        assert!(resume_target(&conn, P, 10).unwrap().is_none());
    }

    #[test]
    fn marquage_manuel_vu_et_a_voir() {
        let conn = setup();
        add_series(&conn);
        conn.execute("INSERT INTO playback_progress VALUES (1, 101, 600.0, 1500.0, 'x')", [])
            .unwrap();
        set_media_status(&conn, P, 101, "done").unwrap();
        assert_eq!(status_of(&conn, 101), "done");
        // La position de reprise est effacée.
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM playback_progress WHERE media_file_id = 101", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
        // Titre entier : tout « Vu », puis tout remis à « À voir ».
        set_title_status(&conn, P, 10, "done").unwrap();
        assert_eq!(title_states(&conn, P, &[10]).unwrap()[0].status, "done");
        set_title_status(&conn, P, 10, "todo").unwrap();
        let s = &title_states(&conn, P, &[10]).unwrap()[0];
        assert_eq!((s.status.as_str(), s.watched), ("todo", 0));
        assert!(set_media_status(&conn, P, 101, "in_progress").is_err());
    }

    #[test]
    fn statuts_separes_par_profil() {
        let conn = setup();
        add_title(&conn, 1, "movie");
        add_file(&conn, 1, Some(1), None);
        record_progress(&conn, 1, 1, 7199.0, FILM).unwrap();
        assert_eq!(repo::media_states(&conn, 1, &[1]).unwrap()[0].status, "done");
        assert_eq!(repo::media_states(&conn, 2, &[1]).unwrap()[0].status, "todo");
    }

    #[test]
    fn la_watchlist_suit_le_statut_automatique() {
        let conn = setup();
        add_title(&conn, 1, "movie");
        add_file(&conn, 1, Some(1), None);
        conn.execute("INSERT INTO watchlist_items (profile_id, title_id) VALUES (1, 1)", []).unwrap();
        let wl = |c: &Connection| -> String {
            c.query_row("SELECT status FROM watchlist_items WHERE title_id = 1", [], |r| r.get(0)).unwrap()
        };
        assert_eq!(wl(&conn), "todo");
        record_progress(&conn, P, 1, 1200.0, FILM).unwrap();
        assert_eq!(wl(&conn), "in_progress");
        record_progress(&conn, P, 1, 7199.0, FILM).unwrap();
        assert_eq!(wl(&conn), "done");
        // Un titre absent de la watchlist n'y est jamais ajouté.
        add_title(&conn, 2, "movie");
        add_file(&conn, 2, Some(2), None);
        record_progress(&conn, P, 2, 7199.0, FILM).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM watchlist_items WHERE title_id = 2", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn fichiers_sans_titre_gardent_l_ancienne_regle() {
        let conn = setup();
        add_file(&conn, 50, None, None); // ex. un morceau de musique
        assert_eq!(record_progress(&conn, P, 50, 190.0, 200.0).unwrap(), Verdict::Completed(CompletedBy::Tail));
        assert_eq!(status_of(&conn, 50), "todo"); // aucun statut posé
    }

    #[test]
    fn migration_reprend_l_existant() {
        // Reproduit l'état d'une base 0.7.8 puis rejoue UNIQUEMENT la 0028.
        let conn = open_with_legacy_tables();
        for m in MIGRATIONS.iter().filter(|m| m.version < 28) {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute_batch(
            "INSERT INTO profiles (id, name, profile_type, created_at) VALUES (1, 'a', 'admin', 'x');
             INSERT INTO media_files (id, library_id, folder_id, path, file_name, size_bytes, modified_at, discovered_at, updated_at)
               VALUES (1,1,1,'/1','f',1,'x','x','x'), (2,1,1,'/2','f',1,'x','x','x'), (3,1,1,'/3','f',1,'x','x','x');
             INSERT INTO watch_history (profile_id, media_file_id, title_id, kind, category_key, position_seconds, duration_seconds, started_at, ended_at)
               VALUES (1,1,1,'movie','films',7000,7200,'x','2026-10-01'),
                      (1,3,1,'movie','films',900,7200,'x','2026-10-02');
             INSERT INTO playback_progress VALUES (1,2,1200,7200,'2026-10-03'), (1,3,900,7200,'2026-10-02'), (1,1,50,7200,'x');",
        )
        .unwrap();
        conn.execute_batch(MIGRATIONS.iter().find(|m| m.version == 28).unwrap().sql).unwrap();
        // 1 : historique à ≥ 95 % → Vu (l'emporte sur la progression de 50 s) ;
        // 2 : progression de 20 min → En cours ; 3 : session à 12 % + progression → En cours.
        let st = |id: i64| status_of(&conn, id);
        assert_eq!((st(1).as_str(), st(2).as_str(), st(3).as_str()), ("done", "in_progress", "in_progress"));
    }
}
