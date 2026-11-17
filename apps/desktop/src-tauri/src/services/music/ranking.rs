//! Classement des résultats MusicBrainz.
//!
//! Le score de MusicBrainz (recherche Lucene) ne connaît ni la popularité ni
//! l'intention de l'utilisateur : une version « live » ou un remix peut passer
//! devant l'enregistrement original. On re-classe donc selon la part des mots
//! saisis retrouvés (artiste + titre), on pénalise les variantes non demandées,
//! et on fusionne les doublons (un même titre apparaît sur de nombreux disques).

use std::collections::{HashMap, HashSet};

use super::models::{MusicAlbum, MusicArtist, MusicTrack};
use super::text::{coverage, normalize, strip_decorations, token_set, tokens, variants_in};

pub struct RawTrack {
    pub track: MusicTrack,
    pub mb_score: u32,
}

pub struct RawAlbum {
    pub album: MusicAlbum,
    pub mb_score: u32,
}

pub struct RawArtist {
    pub artist: MusicArtist,
    pub mb_score: u32,
}

const VARIANT_PENALTY: f64 = 0.15;
const VARIANT_PENALTY_CAP: f64 = 0.45;

fn requested_variants(query: &str) -> HashSet<&'static str> {
    variants_in(query).into_iter().collect()
}

fn variant_penalty(found: &[&'static str], requested: &HashSet<&'static str>) -> f64 {
    let unrequested = found.iter().filter(|v| !requested.contains(*v)).count() as f64;
    (unrequested * VARIANT_PENALTY).min(VARIANT_PENALTY_CAP)
}

pub fn rank_tracks(query: &str, raw: Vec<RawTrack>, limit: usize) -> Vec<MusicTrack> {
    let wanted = tokens(query);
    let requested = requested_variants(query);
    let mut best: HashMap<String, (f64, MusicTrack)> = HashMap::new();
    for item in raw {
        let t = item.track;
        let hay = token_set(&format!("{} {}", t.artist, t.title));
        let variants = variants_in(&t.title);
        let mut value = coverage(&wanted, &hay) + f64::from(item.mb_score.min(100)) / 100.0 * 0.3
            - variant_penalty(&variants, &requested);
        if t.album.is_some() {
            value += 0.05;
        }
        if t.isrc.is_some() {
            value += 0.03;
        }
        if t.duration_ms.is_some() {
            value += 0.02;
        }
        let key = format!(
            "{}|{}|{}",
            normalize(&t.artist),
            normalize(&strip_decorations(&t.title)),
            variants.join("+")
        );
        match best.get(&key) {
            Some((existing, _)) if *existing >= value => {}
            _ => {
                best.insert(key, (value, t));
            }
        }
    }
    let mut ranked: Vec<(f64, MusicTrack)> = best.into_values().collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.title.cmp(&b.1.title)));
    ranked.into_iter().take(limit).map(|(_, t)| t).collect()
}

fn kind_bonus(kind: &str) -> f64 {
    match kind {
        "album" => 0.10,
        "ep" => 0.05,
        "single" => 0.03,
        _ => 0.0,
    }
}

/// Types secondaires qui font d'un album autre chose que le disque studio.
fn secondary_penalty(secondary: &[String], requested: &HashSet<&'static str>) -> f64 {
    let mut penalty = 0.0;
    for s in secondary {
        let lower = s.to_lowercase();
        let asked = ["live", "remix", "demo"].iter().any(|w| lower.contains(w) && requested.contains(w));
        if !asked && ["live", "compilation", "remix", "dj-mix", "mixtape", "demo", "interview"].iter().any(|w| lower.contains(w)) {
            penalty += 0.12;
        }
    }
    penalty
}

pub fn rank_albums(query: &str, raw: Vec<RawAlbum>, limit: usize) -> Vec<MusicAlbum> {
    let wanted = tokens(query);
    let requested = requested_variants(query);
    let mut best: HashMap<String, (f64, MusicAlbum)> = HashMap::new();
    for item in raw {
        let a = item.album;
        let hay = token_set(&format!("{} {}", a.artist, a.title));
        let value = coverage(&wanted, &hay) + f64::from(item.mb_score.min(100)) / 100.0 * 0.3
            + kind_bonus(&a.kind)
            - secondary_penalty(&a.secondary_types, &requested);
        let key = format!("{}|{}|{}", normalize(&a.artist), normalize(&a.title), a.secondary_types.join("+"));
        match best.get(&key) {
            Some((existing, _)) if *existing >= value => {}
            _ => {
                best.insert(key, (value, a));
            }
        }
    }
    let mut ranked: Vec<(f64, MusicAlbum)> = best.into_values().collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.title.cmp(&b.1.title)));
    ranked.into_iter().take(limit).map(|(_, a)| a).collect()
}

pub fn rank_artists(query: &str, raw: Vec<RawArtist>, limit: usize) -> Vec<MusicArtist> {
    let wanted = tokens(query);
    let query_norm = normalize(query);
    let mut ranked: Vec<(f64, MusicArtist)> = raw
        .into_iter()
        .map(|item| {
            let a = item.artist;
            let hay = token_set(&a.name);
            let mut value = coverage(&wanted, &hay) + f64::from(item.mb_score.min(100)) / 100.0 * 0.3;
            if normalize(&a.name) == query_norm {
                value += 0.3;
            }
            (value, a)
        })
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    ranked.into_iter().take(limit).map(|(_, a)| a).collect()
}

/// Ordre d'affichage d'une discographie : albums, puis EP, puis singles ; dans
/// chaque groupe les disques studio avant les live / compilations, du plus récent
/// au plus ancien.
pub fn sort_discography(albums: &mut [MusicAlbum]) {
    let group = |a: &MusicAlbum| match a.kind.as_str() {
        "album" => 0,
        "ep" => 1,
        "single" => 2,
        _ => 3,
    };
    albums.sort_by(|a, b| {
        group(a)
            .cmp(&group(b))
            .then_with(|| a.secondary_types.is_empty().cmp(&b.secondary_types.is_empty()).reverse())
            .then_with(|| b.year.cmp(&a.year))
            .then_with(|| a.title.cmp(&b.title))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, artist: &str, title: &str, album: Option<&str>, score: u32) -> RawTrack {
        RawTrack {
            track: MusicTrack {
                id: id.into(),
                title: title.into(),
                artist: artist.into(),
                artist_id: None,
                album: album.map(str::to_string),
                album_id: None,
                year: None,
                duration_ms: Some(320_000),
                isrc: None,
                cover_url: None,
                position: None,
            },
            mb_score: score,
        }
    }

    fn titles(v: &[MusicTrack]) -> Vec<String> {
        v.iter().map(|t| format!("{} - {}", t.artist, t.title)).collect()
    }

    #[test]
    fn l_original_passe_avant_le_live_et_le_remix() {
        let raw = vec![
            track("1", "Daft Punk", "One More Time (Live at Bercy)", Some("Alive 2007"), 100),
            track("2", "Daft Punk", "One More Time (Remix)", None, 98),
            track("3", "Daft Punk", "One More Time", Some("Discovery"), 90),
        ];
        let ranked = rank_tracks("daft punk one more time", raw, 10);
        assert_eq!(ranked[0].id, "3");
        assert_eq!(ranked.len(), 3);
    }

    #[test]
    fn une_variante_demandee_n_est_pas_penalisee() {
        let raw = vec![
            track("1", "Daft Punk", "One More Time (Live at Bercy)", Some("Alive 2007"), 100),
            track("3", "Daft Punk", "One More Time", Some("Discovery"), 90),
        ];
        let ranked = rank_tracks("daft punk one more time live", raw, 10);
        assert_eq!(ranked[0].id, "1");
    }

    #[test]
    fn les_doublons_sont_fusionnes_en_gardant_le_meilleur() {
        let raw = vec![
            track("a", "Daft Punk", "One More Time", None, 80),
            track("b", "Daft Punk", "One More Time (Remastered 2011)", Some("Discovery"), 95),
            track("c", "daft punk", "ONE MORE TIME", Some("Discovery (Deluxe)"), 70),
        ];
        let ranked = rank_tracks("one more time", raw, 10);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].id, "b");
    }

    #[test]
    fn la_couverture_des_mots_prime_sur_le_score_brut() {
        let raw = vec![
            track("1", "Autre Artiste", "Time", Some("X"), 100),
            track("2", "Daft Punk", "Harder, Better, Faster, Stronger", Some("Discovery"), 70),
        ];
        let ranked = rank_tracks("daft punk harder better faster stronger", raw, 10);
        assert_eq!(titles(&ranked)[0], "Daft Punk - Harder, Better, Faster, Stronger");
    }

    #[test]
    fn saisie_artiste_tiret_titre() {
        let raw = vec![
            track("1", "Étienne Daho", "Week-end à Rome", Some("Pop Satori"), 90),
            track("2", "Daho", "Rome", None, 100),
        ];
        let ranked = rank_tracks("Etienne Daho - Week end a Rome", raw, 10);
        assert_eq!(ranked[0].id, "1");
    }

    fn album(id: &str, title: &str, kind: &str, secondary: &[&str], year: i32, score: u32) -> RawAlbum {
        RawAlbum {
            album: MusicAlbum {
                id: id.into(),
                title: title.into(),
                artist: "Daft Punk".into(),
                artist_id: None,
                year: Some(year),
                kind: kind.into(),
                secondary_types: secondary.iter().map(|s| s.to_string()).collect(),
                cover_url: String::new(),
            },
            mb_score: score,
        }
    }

    #[test]
    fn l_album_studio_passe_avant_le_live_et_la_compilation() {
        let raw = vec![
            album("1", "Alive 2007", "album", &["Live"], 2007, 100),
            album("2", "Discovery", "album", &[], 2001, 90),
            album("3", "Discovery Remixes", "album", &["Compilation", "Remix"], 2003, 95),
        ];
        let ranked = rank_albums("daft punk discovery", raw, 10);
        assert_eq!(ranked[0].id, "2");
    }

    #[test]
    fn artistes_nom_exact_d_abord() {
        let mk = |id: &str, name: &str, score: u32| RawArtist {
            artist: MusicArtist {
                id: id.into(),
                name: name.into(),
                disambiguation: None,
                country: None,
                kind: None,
                active_years: None,
            },
            mb_score: score,
        };
        let ranked = rank_artists("Daft Punk", vec![mk("1", "Daft Punk Tribute Band", 100), mk("2", "Daft Punk", 90)], 10);
        assert_eq!(ranked[0].id, "2");
    }

    #[test]
    fn discographie_albums_studio_recents_d_abord() {
        let mut albums: Vec<MusicAlbum> = vec![
            album("s", "Single", "single", &[], 2013, 0),
            album("l", "Alive 2007", "album", &["Live"], 2007, 0),
            album("a1", "Discovery", "album", &[], 2001, 0),
            album("a2", "Random Access Memories", "album", &[], 2013, 0),
            album("e", "Petit EP", "ep", &[], 2010, 0),
        ]
        .into_iter()
        .map(|r| r.album)
        .collect();
        sort_discography(&mut albums);
        let ids: Vec<&str> = albums.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["a2", "a1", "l", "e", "s"]);
    }
}
