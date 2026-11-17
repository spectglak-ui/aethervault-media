//! Résolveur : retrouve sur YouTube la bonne version audio d'un titre du catalogue.
//!
//! Une recherche YouTube brute mélange clips, lives, reprises, karaokés et
//! versions accélérées. On interroge YouTube avec « artiste titre », puis on note
//! chaque candidat : mots du titre et de l'artiste retrouvés, **durée** proche de
//! celle de l'enregistrement (le signal le plus fiable), chaîne « Topic » ou de
//! l'artiste, pénalité pour les variantes que l'utilisateur n'a pas demandées. Le
//! meilleur choix sûr est mémorisé (`music_track_matches`) : un titre n'est
//! cherché qu'une fois, et l'utilisateur peut corriger un mauvais choix.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use super::text::{coverage, normalize, strip_decorations, token_set, tokens};

/// Confiance minimale pour proposer un candidat, et pour le mémoriser.
pub const MIN_ACCEPT: f64 = 0.35;
pub const MIN_CACHE: f64 = 0.60;
/// Au-delà, inutile de lancer une seconde recherche.
const GOOD_ENOUGH: f64 = 0.80;

#[derive(Debug, Clone)]
pub struct ResolveRequest {
    /// MBID de l'enregistrement si le titre vient du catalogue.
    pub mbid: Option<String>,
    pub artist: String,
    pub title: String,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub duration_s: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Alternative {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub duration_s: Option<i64>,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Resolution {
    /// Clé de mémorisation du titre (à renvoyer pour corriger le choix).
    pub track_key: String,
    pub video_id: String,
    pub confidence: f64,
    pub cached: bool,
    /// Choisi à la main par l'utilisateur.
    pub verified: bool,
    pub alternatives: Vec<Alternative>,
}

/// Mots d'une vidéo qui n'est pas l'enregistrement original.
const PENALTY_WORDS: &[&str] = &[
    "live", "remix", "cover", "karaoke", "instrumental", "slowed", "sped", "reverb", "nightcore", "mashup", "reaction",
    "tutorial", "lesson", "piano", "guitar", "concert", "tribute", "medley", "boosted", "8d",
];

pub fn track_key(mbid: Option<&str>, artist: &str, title: &str) -> String {
    match mbid {
        Some(id) if !id.is_empty() => format!("mb:{id}"),
        _ => format!("norm:{}|{}", normalize(artist), normalize(&strip_decorations(title))),
    }
}

/// Note (0–1) d'un candidat pour la demande.
pub fn score_candidate(req: &ResolveRequest, c: &Candidate) -> f64 {
    let title_tokens = tokens(&strip_decorations(&req.title));
    let artist_tokens = tokens(&req.artist);
    let cand_title = token_set(&c.title);
    let channel_tokens = token_set(&c.channel);
    let in_title_or_channel: HashSet<String> = cand_title.union(&channel_tokens).cloned().collect();

    // Les poids sont choisis pour que le total reste < 1 : un plafonnement
    // ex æquo effacerait la différence entre un audio officiel et un clip.
    let mut score = 0.36 * coverage(&title_tokens, &cand_title) + 0.20 * coverage(&artist_tokens, &in_title_or_channel);

    if let (Some(want_ms), Some(got_s)) = (req.duration_ms, c.duration_s) {
        let diff = (i64::try_from(want_ms / 1000).unwrap_or(i64::MAX) - got_s).abs();
        score += match diff {
            0..=2 => 0.30,
            3..=5 => 0.20,
            6..=10 => 0.05,
            11..=20 => -0.10,
            _ => -0.30,
        };
    }

    // Chaîne : « Artiste - Topic » (audio officiel généré par YouTube Music), ou la
    // chaîne de l'artiste, ou VEVO.
    if channel_tokens.contains("topic") {
        score += 0.10;
    } else if !artist_tokens.is_empty() && coverage(&artist_tokens, &channel_tokens) >= 1.0 {
        score += 0.07;
    } else if channel_tokens.contains("vevo") {
        score += 0.05;
    }

    // Variantes non demandées (live, remix, reprise, karaoké…).
    let requested: HashSet<String> = token_set(&format!("{} {}", req.title, req.artist));
    let penalised = PENALTY_WORDS.iter().filter(|w| cand_title.contains(**w) && !requested.contains(**w)).count();
    score -= 0.30 * penalised.min(2) as f64;

    if cand_title.contains("official") && cand_title.contains("audio") {
        score += 0.03;
    }
    score.clamp(0.0, 1.0)
}

fn rank(req: &ResolveRequest, candidates: Vec<Candidate>) -> Vec<(Candidate, f64)> {
    let mut scored: Vec<(Candidate, f64)> = candidates
        .into_iter()
        .filter(|c| !c.video_id.is_empty())
        .map(|c| {
            let s = score_candidate(req, &c);
            (c, s)
        })
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.video_id.cmp(&b.0.video_id)));
    scored
}

// ---- Mémorisation --------------------------------------------------------------

pub fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    // Table créée à la demande (comme les segments d'épisodes) : pas de migration.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS music_track_matches (
            track_key   TEXT PRIMARY KEY,
            video_id    TEXT NOT NULL,
            confidence  REAL NOT NULL,
            verified    INTEGER NOT NULL DEFAULT 0,
            resolved_at TEXT NOT NULL
        );",
    )
}

pub fn cached(conn: &Connection, key: &str) -> rusqlite::Result<Option<(String, f64, bool)>> {
    conn.query_row(
        "SELECT video_id, confidence, verified FROM music_track_matches WHERE track_key = ?1",
        params![key],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?, row.get::<_, i64>(2)? != 0)),
    )
    .optional()
}

pub fn store(conn: &Connection, key: &str, video_id: &str, confidence: f64, verified: bool) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO music_track_matches (track_key, video_id, confidence, verified, resolved_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(track_key) DO UPDATE SET
            video_id = excluded.video_id, confidence = excluded.confidence,
            verified = excluded.verified, resolved_at = excluded.resolved_at",
        params![key, video_id, confidence, i64::from(verified), chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

/// Un identifiant de vidéo YouTube : 11 caractères `[A-Za-z0-9_-]`.
pub fn is_youtube_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Choix manuel de l'utilisateur : toujours prioritaire sur le choix automatique.
pub fn set_manual_match(conn: &Connection, key: &str, video_id: &str) -> Result<(), String> {
    if !is_youtube_id(video_id) {
        return Err("Identifiant de vidéo invalide.".to_string());
    }
    ensure_table(conn).map_err(|e| e.to_string())?;
    store(conn, key, video_id, 1.0, true).map_err(|e| e.to_string())
}

// ---- Résolution --------------------------------------------------------------------

/// `search` interroge YouTube (« artiste titre ») et renvoie des candidats.
pub fn resolve(
    conn: &Connection,
    req: &ResolveRequest,
    search: &dyn Fn(&str) -> Result<Vec<Candidate>, String>,
) -> Result<Resolution, String> {
    ensure_table(conn).map_err(|e| e.to_string())?;
    let key = track_key(req.mbid.as_deref(), &req.artist, &req.title);
    if let Some((video_id, confidence, verified)) = cached(conn, &key).map_err(|e| e.to_string())? {
        return Ok(Resolution { track_key: key, video_id, confidence, cached: true, verified, alternatives: Vec::new() });
    }

    let clean_title = strip_decorations(&req.title);
    let queries = [format!("{} {}", req.artist, clean_title), format!("{} {} audio", req.artist, clean_title)];
    let mut ranked: Vec<(Candidate, f64)> = Vec::new();
    let mut last_error = None;
    for (i, query) in queries.iter().enumerate() {
        match search(query) {
            Ok(found) => {
                for (candidate, score) in rank(req, found) {
                    match ranked.iter_mut().find(|(c, _)| c.video_id == candidate.video_id) {
                        Some(existing) if existing.1 >= score => {}
                        Some(existing) => *existing = (candidate, score),
                        None => ranked.push((candidate, score)),
                    }
                }
                ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.video_id.cmp(&b.0.video_id)));
            }
            Err(e) => last_error = Some(e),
        }
        if ranked.first().is_some_and(|(_, s)| *s >= GOOD_ENOUGH) || i == queries.len() - 1 {
            break;
        }
    }

    let Some((best, confidence)) = ranked.first().cloned() else {
        return Err(last_error.unwrap_or_else(|| "Aucune version trouvée pour ce titre.".to_string()));
    };
    if confidence < MIN_ACCEPT {
        return Err("Aucune version fiable trouvée pour ce titre.".to_string());
    }
    if confidence >= MIN_CACHE {
        store(conn, &key, &best.video_id, confidence, false).map_err(|e| e.to_string())?;
    }
    let alternatives = ranked
        .iter()
        .skip(1)
        .filter(|(_, s)| *s >= 0.2)
        .take(4)
        .map(|(c, s)| Alternative {
            video_id: c.video_id.clone(),
            title: c.title.clone(),
            channel: c.channel.clone(),
            duration_s: c.duration_s,
            score: *s,
        })
        .collect();
    Ok(Resolution { track_key: key, video_id: best.video_id, confidence, cached: false, verified: false, alternatives })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn req() -> ResolveRequest {
        ResolveRequest {
            mbid: Some("11111111-1111-1111-1111-111111111111".into()),
            artist: "Daft Punk".into(),
            title: "One More Time".into(),
            duration_ms: Some(320_000),
        }
    }

    fn cand(id: &str, title: &str, channel: &str, duration: Option<i64>) -> Candidate {
        Candidate { video_id: id.into(), title: title.into(), channel: channel.into(), duration_s: duration }
    }

    fn id(n: u8) -> String {
        format!("video{n:06}")
    }

    #[test]
    fn l_audio_officiel_bat_le_live_la_reprise_et_le_karaoke() {
        let r = req();
        let official = score_candidate(&r, &cand("a", "One More Time", "Daft Punk - Topic", Some(320)));
        let clip = score_candidate(&r, &cand("b", "Daft Punk - One More Time (Official Video)", "Daft Punk", Some(321)));
        let live = score_candidate(&r, &cand("c", "Daft Punk - One More Time (Live at Bercy)", "Daft Punk", Some(402)));
        let cover = score_candidate(&r, &cand("d", "One More Time - Daft Punk cover", "Un Fan", Some(318)));
        let karaoke = score_candidate(&r, &cand("e", "Daft Punk - One More Time (Karaoke Version)", "KaraokeHits", Some(320)));
        let sped = score_candidate(&r, &cand("f", "one more time daft punk sped up", "x", Some(200)));
        assert!(official > clip, "{official} vs {clip}");
        assert!(clip > live);
        assert!(official > cover + 0.2);
        assert!(official > karaoke + 0.2);
        assert!(official > sped + 0.4);
        assert!(official >= MIN_CACHE && clip >= MIN_CACHE);
        assert!(live < MIN_CACHE && cover < MIN_CACHE && karaoke < MIN_CACHE);
    }

    #[test]
    fn la_duree_departage_deux_titres_identiques() {
        let r = req();
        let close = score_candidate(&r, &cand("a", "Daft Punk - One More Time", "Daft Punk", Some(321)));
        let far = score_candidate(&r, &cand("b", "Daft Punk - One More Time", "Daft Punk", Some(600)));
        assert!(close > far + 0.4);
        // Sans durée connue des deux côtés : pas de bonus ni de malus.
        let mut no_duration = req();
        no_duration.duration_ms = None;
        assert_eq!(
            score_candidate(&no_duration, &cand("a", "Daft Punk - One More Time", "Daft Punk", Some(321))),
            score_candidate(&no_duration, &cand("b", "Daft Punk - One More Time", "Daft Punk", Some(600)))
        );
    }

    #[test]
    fn une_variante_demandee_n_est_pas_penalisee() {
        let r = ResolveRequest { mbid: None, artist: "Daft Punk".into(), title: "One More Time (Live)".into(), duration_ms: None };
        let live = score_candidate(&r, &cand("c", "Daft Punk - One More Time (Live at Bercy)", "Daft Punk", None));
        let studio = score_candidate(&r, &cand("a", "Daft Punk - One More Time", "Daft Punk", None));
        assert!(live >= studio - 0.01);
        // « Live Forever » n'est pas une variante quand « live » est dans le titre demandé.
        let oasis = ResolveRequest { mbid: None, artist: "Oasis".into(), title: "Live Forever".into(), duration_ms: Some(276_000) };
        assert!(score_candidate(&oasis, &cand("o", "Oasis - Live Forever (Remastered)", "Oasis", Some(277))) >= MIN_CACHE);
    }

    #[test]
    fn la_cle_de_memorisation_est_stable() {
        assert_eq!(track_key(Some("abc"), "A", "B"), "mb:abc");
        assert_eq!(
            track_key(None, "Étienne Daho", "Week-end à Rome (Remastered)"),
            track_key(None, "etienne daho", "Week end a Rome")
        );
        assert_ne!(track_key(None, "A", "B"), track_key(None, "A", "C"));
    }

    #[test]
    fn identifiant_youtube_valide() {
        assert!(is_youtube_id("dQw4w9WgXcQ"));
        assert!(is_youtube_id("a-_B1234567"));
        assert!(!is_youtube_id("dQw4w9WgXc"));
        assert!(!is_youtube_id("dQw4w9WgXc!"));
        assert!(!is_youtube_id("https://youtu.be/dQw4w9WgXcQ"));
    }

    fn db() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn resout_memorise_puis_ne_recherche_plus() {
        let conn = db();
        let calls = Cell::new(0);
        let search = |_: &str| -> Result<Vec<Candidate>, String> {
            calls.set(calls.get() + 1);
            Ok(vec![
                cand(&id(1), "Daft Punk - One More Time (Live at Bercy)", "Daft Punk", Some(402)),
                cand(&id(2), "One More Time", "Daft Punk - Topic", Some(320)),
                cand(&id(3), "One More Time (Karaoke)", "KaraokeHits", Some(320)),
            ])
        };
        let first = resolve(&conn, &req(), &search).unwrap();
        assert_eq!(first.video_id, id(2));
        assert!(!first.cached && !first.verified);
        assert!(first.confidence >= MIN_CACHE);
        assert!(!first.alternatives.is_empty());
        assert_eq!(calls.get(), 1); // la première recherche suffit (confiance élevée)

        let again = resolve(&conn, &req(), &search).unwrap();
        assert!(again.cached);
        assert_eq!(again.video_id, id(2));
        assert_eq!(calls.get(), 1); // aucun nouvel appel réseau
    }

    #[test]
    fn le_choix_manuel_remplace_le_choix_automatique() {
        let conn = db();
        let search = |_: &str| -> Result<Vec<Candidate>, String> {
            Ok(vec![cand(&id(2), "One More Time", "Daft Punk - Topic", Some(320))])
        };
        let first = resolve(&conn, &req(), &search).unwrap();
        set_manual_match(&conn, &first.track_key, "dQw4w9WgXcQ").unwrap();
        let after = resolve(&conn, &req(), &search).unwrap();
        assert_eq!(after.video_id, "dQw4w9WgXcQ");
        assert!(after.verified && after.cached);
        assert!(set_manual_match(&conn, &first.track_key, "pas un id").is_err());
    }

    #[test]
    fn seconde_recherche_si_la_premiere_est_mediocre() {
        let conn = db();
        let calls = Cell::new(0);
        let search = |q: &str| -> Result<Vec<Candidate>, String> {
            calls.set(calls.get() + 1);
            if q.ends_with("audio") {
                Ok(vec![cand(&id(9), "One More Time", "Daft Punk - Topic", Some(320))])
            } else {
                Ok(vec![cand(&id(1), "Quelqu'un reprend One More Time", "Fan", Some(250))])
            }
        };
        let res = resolve(&conn, &req(), &search).unwrap();
        assert_eq!(calls.get(), 2);
        assert_eq!(res.video_id, id(9));
    }

    #[test]
    fn resultats_hors_sujet_donnent_une_erreur_et_ne_sont_pas_memorises() {
        let conn = db();
        let search = |_: &str| -> Result<Vec<Candidate>, String> {
            Ok(vec![cand(&id(1), "Tutoriel piano pour débutants", "Prof Piano", Some(900))])
        };
        assert!(resolve(&conn, &req(), &search).is_err());
        assert_eq!(cached(&conn, &track_key(req().mbid.as_deref(), "Daft Punk", "One More Time")).unwrap(), None);
    }

    #[test]
    fn une_confiance_moyenne_est_proposee_mais_pas_memorisee() {
        let conn = db();
        let mut r = req();
        r.duration_ms = None;
        let search = |_: &str| -> Result<Vec<Candidate>, String> {
            // Bon titre, mais aucune chaîne d'artiste et pas de durée : confiance < 0,6.
            Ok(vec![cand(&id(4), "One More Time", "Une chaîne", None)])
        };
        let res = resolve(&conn, &r, &search).unwrap();
        assert!(res.confidence >= MIN_ACCEPT && res.confidence < MIN_CACHE);
        assert_eq!(cached(&conn, &res.track_key).unwrap(), None);
    }

    #[test]
    fn une_erreur_reseau_est_renvoyee_sans_resultat() {
        let conn = db();
        let search = |_: &str| -> Result<Vec<Candidate>, String> { Err("hors ligne".to_string()) };
        assert_eq!(resolve(&conn, &req(), &search).unwrap_err(), "hors ligne");
    }
}
