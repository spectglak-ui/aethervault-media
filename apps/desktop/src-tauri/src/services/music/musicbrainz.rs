//! Client de l'API MusicBrainz (https://musicbrainz.org/doc/MusicBrainz_API).
//!
//! Règles de l'API respectées : User-Agent explicite, au plus UNE requête par
//! seconde et par client (file d'attente interne), nouvel essai unique sur 503.
//! Les réponses sont gardées 15 minutes en mémoire (changer d'onglet ne refait
//! pas de requête). L'analyse des réponses (`parse_*`) est séparée du réseau pour
//! être testée sur des réponses types.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

use super::models::{cover_art_url, MusicAlbum, MusicAlbumDetail, MusicArtist, MusicSearchResponse, MusicTrack};
use super::ranking::{self, RawAlbum, RawArtist, RawTrack};
use super::text::is_mbid;

const BASE: &str = "https://musicbrainz.org/ws/2";
/// Intervalle minimal entre deux requêtes (la règle est « 1 par seconde »).
const MIN_INTERVAL: Duration = Duration::from_millis(1100);
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const CACHE_MAX: usize = 300;
const USER_AGENT: &str = concat!(
    "AetherVaultMedia/",
    env!("CARGO_PKG_VERSION"),
    " ( https://github.com/spectglak-ui/aethervault-media )"
);

// ---- Réponses JSON (champs facultatifs : MusicBrainz omet les valeurs vides) ----

#[derive(Deserialize, Default, Debug)]
struct ArtistRef {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize, Default, Debug)]
struct Credit {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    joinphrase: Option<String>,
    #[serde(default)]
    artist: Option<ArtistRef>,
}

#[derive(Deserialize, Default, Debug)]
struct LifeSpan {
    #[serde(default)]
    begin: Option<String>,
    #[serde(default)]
    end: Option<String>,
}

#[derive(Deserialize, Debug)]
struct MbArtist {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    score: Option<u32>,
    #[serde(default)]
    country: Option<String>,
    #[serde(default)]
    disambiguation: Option<String>,
    #[serde(default, rename = "life-span")]
    life_span: Option<LifeSpan>,
}

#[derive(Deserialize, Default, Debug)]
struct ArtistList {
    #[serde(default)]
    artists: Vec<MbArtist>,
}

#[derive(Deserialize, Debug)]
struct MbReleaseGroup {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default, rename = "primary-type")]
    primary_type: Option<String>,
    #[serde(default, rename = "secondary-types")]
    secondary_types: Vec<String>,
    #[serde(default, rename = "first-release-date")]
    first_release_date: Option<String>,
    #[serde(default)]
    score: Option<u32>,
    #[serde(default, rename = "artist-credit")]
    artist_credit: Vec<Credit>,
}

#[derive(Deserialize, Default, Debug)]
struct ReleaseGroupList {
    #[serde(default, rename = "release-groups")]
    release_groups: Vec<MbReleaseGroup>,
}

#[derive(Deserialize, Default, Debug)]
struct ReleaseGroupRef {
    #[serde(default)]
    id: Option<String>,
    #[serde(default, rename = "primary-type")]
    primary_type: Option<String>,
    #[serde(default, rename = "secondary-types")]
    secondary_types: Vec<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Deserialize, Default, Debug)]
struct MbRecordingLite {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    length: Option<u64>,
    #[serde(default)]
    isrcs: Vec<String>,
    #[serde(default, rename = "artist-credit")]
    artist_credit: Vec<Credit>,
}

#[derive(Deserialize, Default, Debug)]
struct MbTrack {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    length: Option<u64>,
    #[serde(default)]
    recording: Option<MbRecordingLite>,
}

#[derive(Deserialize, Default, Debug)]
struct Medium {
    // « tracks » dans une consultation, « track » dans un résultat de recherche.
    #[serde(default, alias = "tracks")]
    track: Vec<MbTrack>,
}

#[derive(Deserialize, Default, Debug)]
struct MbRelease {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default, rename = "release-group")]
    release_group: Option<ReleaseGroupRef>,
    #[serde(default)]
    media: Vec<Medium>,
    #[serde(default, rename = "artist-credit")]
    artist_credit: Vec<Credit>,
}

#[derive(Deserialize, Debug)]
struct MbRecording {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    length: Option<u64>,
    #[serde(default)]
    score: Option<u32>,
    #[serde(default, rename = "artist-credit")]
    artist_credit: Vec<Credit>,
    #[serde(default, rename = "first-release-date")]
    first_release_date: Option<String>,
    #[serde(default)]
    isrcs: Vec<String>,
    #[serde(default)]
    releases: Vec<MbRelease>,
}

#[derive(Deserialize, Default, Debug)]
struct RecordingList {
    #[serde(default)]
    recordings: Vec<MbRecording>,
}

#[derive(Deserialize, Default, Debug)]
struct ReleaseList {
    #[serde(default)]
    releases: Vec<MbRelease>,
}

// ---- Conversion ---------------------------------------------------------------

/// « A feat. B » à partir des crédits, et MBID du premier artiste.
fn credit_text(credits: &[Credit]) -> (String, Option<String>) {
    let mut text = String::new();
    let mut first_id = None;
    for (i, credit) in credits.iter().enumerate() {
        let name = credit
            .name
            .clone()
            .or_else(|| credit.artist.as_ref().and_then(|a| a.name.clone()))
            .unwrap_or_default();
        text.push_str(&name);
        if i == 0 {
            first_id = credit.artist.as_ref().and_then(|a| a.id.clone());
        }
        text.push_str(credit.joinphrase.as_deref().unwrap_or(""));
    }
    (text.trim().to_string(), first_id)
}

fn year_of(date: Option<&str>) -> Option<i32> {
    let d = date?;
    let year: String = d.chars().take(4).collect();
    if year.len() == 4 && year.chars().all(|c| c.is_ascii_digit()) { year.parse().ok() } else { None }
}

fn album_kind(primary: Option<&str>) -> String {
    match primary.map(str::to_lowercase).as_deref() {
        Some("album") => "album",
        Some("single") => "single",
        Some("ep") => "ep",
        _ => "autre",
    }
    .to_string()
}

fn first_isrc(isrcs: &[String]) -> Option<String> {
    isrcs.first().cloned()
}

fn convert_release_group(rg: MbReleaseGroup) -> MusicAlbum {
    let (artist, artist_id) = credit_text(&rg.artist_credit);
    MusicAlbum {
        cover_url: cover_art_url(&rg.id),
        year: year_of(rg.first_release_date.as_deref()),
        kind: album_kind(rg.primary_type.as_deref()),
        secondary_types: rg.secondary_types,
        title: rg.title,
        artist,
        artist_id,
        id: rg.id,
    }
}

/// Édition d'un titre à retenir comme « album » : officielle, de type album sans
/// type secondaire (ni live ni compilation), la plus ancienne.
fn best_release(releases: &[MbRelease]) -> Option<&MbRelease> {
    releases.iter().min_by_key(|r| {
        let official = r.status.as_deref().map_or(1, |s| if s.eq_ignore_ascii_case("official") { 0 } else { 1 });
        let (is_album, no_secondary) = match &r.release_group {
            Some(rg) => (
                rg.primary_type.as_deref().is_some_and(|t| t.eq_ignore_ascii_case("album")),
                rg.secondary_types.is_empty(),
            ),
            None => (false, true),
        };
        (
            official,
            u8::from(!(is_album && no_secondary)),
            r.date.clone().filter(|d| !d.is_empty()).unwrap_or_else(|| "9999".to_string()),
        )
    })
}

/// Décode une réponse ; `null` (404 : rien trouvé) donne une liste vide.
fn decode<T: DeserializeOwned + Default>(value: &Value) -> Result<T, String> {
    if value.is_null() {
        return Ok(T::default());
    }
    serde_json::from_value(value.clone()).map_err(|e| format!("Réponse MusicBrainz illisible : {e}"))
}

fn parse_artist_search(value: &Value) -> Result<Vec<RawArtist>, String> {
    let list: ArtistList = decode(value)?;
    Ok(list
        .artists
        .into_iter()
        .map(|a| {
            let years = a.life_span.as_ref().and_then(|l| {
                let begin = year_of(l.begin.as_deref());
                let end = year_of(l.end.as_deref());
                match (begin, end) {
                    (Some(b), Some(e)) => Some(format!("{b} – {e}")),
                    (Some(b), None) => Some(format!("depuis {b}")),
                    _ => None,
                }
            });
            RawArtist {
                mb_score: a.score.unwrap_or(0),
                artist: MusicArtist {
                    id: a.id,
                    name: a.name,
                    disambiguation: a.disambiguation.filter(|d| !d.is_empty()),
                    country: a.country,
                    kind: a.kind,
                    active_years: years,
                },
            }
        })
        .collect())
}

fn parse_release_groups(value: &Value) -> Result<Vec<RawAlbum>, String> {
    let list: ReleaseGroupList = decode(value)?;
    Ok(list
        .release_groups
        .into_iter()
        .map(|rg| RawAlbum { mb_score: rg.score.unwrap_or(0), album: convert_release_group(rg) })
        .collect())
}

fn parse_track_search(value: &Value) -> Result<Vec<RawTrack>, String> {
    let list: RecordingList = decode(value)?;
    Ok(list
        .recordings
        .into_iter()
        .map(|r| {
            let (artist, artist_id) = credit_text(&r.artist_credit);
            let release = best_release(&r.releases);
            let album_id = release.and_then(|rel| rel.release_group.as_ref().and_then(|g| g.id.clone()));
            let year = year_of(release.and_then(|rel| rel.date.as_deref()))
                .or_else(|| year_of(r.first_release_date.as_deref()));
            RawTrack {
                mb_score: r.score.unwrap_or(0),
                track: MusicTrack {
                    cover_url: album_id.as_deref().map(cover_art_url),
                    album: release.and_then(|rel| rel.title.clone()).filter(|t| !t.is_empty()),
                    album_id,
                    year,
                    duration_ms: r.length,
                    isrc: first_isrc(&r.isrcs),
                    position: None,
                    title: r.title,
                    id: r.id,
                    artist,
                    artist_id,
                },
            }
        })
        .collect())
}

/// Pistes de l'édition la plus pertinente d'un album (`release_group_id`).
fn parse_album_detail(value: &Value, release_group_id: &str) -> Result<Option<MusicAlbumDetail>, String> {
    let list: ReleaseList = decode(value)?;
    // L'édition la plus ancienne qui a une liste de pistes (la « standard », pas la deluxe).
    let release = list
        .releases
        .iter()
        .filter(|r| r.media.iter().any(|m| !m.track.is_empty()))
        .min_by_key(|r| {
            let official = r.status.as_deref().map_or(1, |s| if s.eq_ignore_ascii_case("official") { 0 } else { 1 });
            let tracks: usize = r.media.iter().map(|m| m.track.len()).sum();
            (official, r.date.clone().filter(|d| !d.is_empty()).unwrap_or_else(|| "9999".to_string()), tracks)
        });
    let Some(release) = release else { return Ok(None) };

    let (album_artist, album_artist_id) = credit_text(&release.artist_credit);
    let year = year_of(release.date.as_deref());
    let cover = cover_art_url(release_group_id);
    let album_title = release.title.clone().unwrap_or_default();
    let rg = release.release_group.as_ref();
    let album = MusicAlbum {
        id: release_group_id.to_string(),
        title: rg.and_then(|g| g.title.clone()).filter(|t| !t.is_empty()).unwrap_or_else(|| album_title.clone()),
        artist: album_artist.clone(),
        artist_id: album_artist_id.clone(),
        year,
        kind: album_kind(rg.and_then(|g| g.primary_type.as_deref()).or(Some("album"))),
        secondary_types: rg.map(|g| g.secondary_types.clone()).unwrap_or_default(),
        cover_url: cover.clone(),
    };

    let mut tracks = Vec::new();
    let mut position = 0u32;
    for medium in &release.media {
        for t in &medium.track {
            position += 1;
            let rec = t.recording.as_ref();
            let (artist, artist_id) = rec
                .map(|r| credit_text(&r.artist_credit))
                .filter(|(a, _)| !a.is_empty())
                .unwrap_or((album_artist.clone(), album_artist_id.clone()));
            let id = rec.and_then(|r| r.id.clone()).or_else(|| t.id.clone()).unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            tracks.push(MusicTrack {
                id,
                title: t.title.clone().or_else(|| rec.and_then(|r| r.title.clone())).unwrap_or_default(),
                artist,
                artist_id,
                album: Some(album.title.clone()),
                album_id: Some(release_group_id.to_string()),
                year,
                duration_ms: t.length.or_else(|| rec.and_then(|r| r.length)),
                isrc: rec.and_then(|r| first_isrc(&r.isrcs)),
                cover_url: Some(cover.clone()),
                position: Some(position),
            });
        }
    }
    Ok(Some(MusicAlbumDetail { album, tracks }))
}

// ---- Requêtes Lucene -----------------------------------------------------------

/// Retire les caractères spéciaux de la syntaxe Lucene (jamais interprétés).
pub fn clean_query(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| if "+-&|!(){}[]^\"~*?:\\/".contains(c) { ' ' } else { c })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// « Artiste - Titre » (tiret entouré d'espaces) → (artiste, titre).
fn split_artist_title(text: &str) -> Option<(String, String)> {
    for sep in [" - ", " – ", " — "] {
        if let Some((a, t)) = text.split_once(sep) {
            let (a, t) = (clean_query(a), clean_query(t));
            if !a.is_empty() && !t.is_empty() {
                return Some((a, t));
            }
        }
    }
    None
}

fn track_query(text: &str) -> String {
    if let Some((artist, title)) = split_artist_title(text) {
        return format!("recording:\"{title}\" AND artist:\"{artist}\"");
    }
    let t = clean_query(text);
    format!("recording:({t}) OR artist:({t})")
}

fn album_query(text: &str) -> String {
    if let Some((artist, title)) = split_artist_title(text) {
        return format!("releasegroup:\"{title}\" AND artist:\"{artist}\"");
    }
    let t = clean_query(text);
    format!("releasegroup:({t}) OR artist:({t})")
}

fn artist_query(text: &str) -> String {
    format!("artist:({})", clean_query(text))
}

fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ---- Réseau : file d'attente 1 requête/s, cache, nouvel essai ---------------------

fn next_slot() -> &'static Mutex<Instant> {
    static SLOT: OnceLock<Mutex<Instant>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(Instant::now()))
}

/// Réserve un créneau et attend son heure : les requêtes simultanées se mettent en
/// file au lieu de dépasser une requête par seconde.
fn wait_for_slot() {
    let wait = {
        let Ok(mut slot) = next_slot().lock() else { return };
        let now = Instant::now();
        let start = (*slot).max(now);
        *slot = start + MIN_INTERVAL;
        start.saturating_duration_since(now)
    };
    if !wait.is_zero() {
        std::thread::sleep(wait);
    }
}

type Cache = HashMap<String, (Instant, Value)>;

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_get(key: &str) -> Option<Value> {
    let guard = cache().lock().ok()?;
    guard.get(key).filter(|(at, _)| at.elapsed() < CACHE_TTL).map(|(_, v)| v.clone())
}

fn cache_put(key: &str, value: &Value) {
    if let Ok(mut guard) = cache().lock() {
        if guard.len() >= CACHE_MAX {
            guard.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
            if guard.len() >= CACHE_MAX {
                guard.clear();
            }
        }
        guard.insert(key.to_string(), (Instant::now(), value.clone()));
    }
}

fn http_get(path_and_query: &str) -> Result<Value, String> {
    if let Some(hit) = cache_get(path_and_query) {
        return Ok(hit);
    }
    let url = format!("{BASE}/{path_and_query}");
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).user_agent(USER_AGENT).build();
    let mut retried = false;
    loop {
        wait_for_slot();
        match agent.get(&url).set("Accept", "application/json").call() {
            Ok(response) => {
                let value: Value = response.into_json().map_err(|e| format!("Réponse MusicBrainz illisible : {e}"))?;
                cache_put(path_and_query, &value);
                return Ok(value);
            }
            Err(ureq::Error::Status(404, _)) => return Ok(Value::Null),
            Err(ureq::Error::Status(429 | 502 | 503 | 504, _)) if !retried => {
                retried = true;
                std::thread::sleep(Duration::from_secs(2));
            }
            Err(ureq::Error::Status(429 | 503, _)) => {
                return Err("MusicBrainz est momentanément saturé : réessayez dans un instant.".to_string());
            }
            Err(ureq::Error::Status(code, _)) => return Err(format!("MusicBrainz a répondu avec le code {code}.")),
            Err(e) => return Err(format!("Impossible de joindre MusicBrainz (êtes-vous hors ligne ?) : {e}")),
        }
    }
}

// ---- API publique ------------------------------------------------------------------

pub fn search(kind: &str, text: &str) -> Result<MusicSearchResponse, String> {
    let text = text.trim();
    if clean_query(text).is_empty() {
        return Err("Saisissez au moins un mot à rechercher.".to_string());
    }
    let mut response = MusicSearchResponse { kind: kind.to_string(), ..Default::default() };
    match kind {
        "track" => {
            let q = percent_encode(&track_query(text));
            let value = http_get(&format!("recording?query={q}&limit=60&fmt=json"))?;
            response.tracks = ranking::rank_tracks(text, parse_track_search(&value)?, 25);
        }
        "album" => {
            let q = percent_encode(&album_query(text));
            let value = http_get(&format!("release-group?query={q}&limit=40&fmt=json"))?;
            response.albums = ranking::rank_albums(text, parse_release_groups(&value)?, 20);
        }
        "artist" => {
            let q = percent_encode(&artist_query(text));
            let value = http_get(&format!("artist?query={q}&limit=20&fmt=json"))?;
            response.artists = ranking::rank_artists(text, parse_artist_search(&value)?, 12);
        }
        other => return Err(format!("Type de recherche inconnu : {other}")),
    }
    Ok(response)
}

/// Discographie d'un artiste (albums, EP, singles).
pub fn artist_albums(artist_id: &str) -> Result<Vec<MusicAlbum>, String> {
    if !is_mbid(artist_id) {
        return Err("Identifiant d'artiste invalide.".to_string());
    }
    let value = http_get(&format!(
        "release-group?artist={artist_id}&type=album%7Cep%7Csingle&inc=artist-credits&limit=100&fmt=json"
    ))?;
    let mut albums: Vec<MusicAlbum> = parse_release_groups(&value)?.into_iter().map(|r| r.album).collect();
    ranking::sort_discography(&mut albums);
    Ok(albums)
}

/// Pistes d'un album. `None` si MusicBrainz n'a aucune liste de pistes.
pub fn album_tracks(album_id: &str) -> Result<Option<MusicAlbumDetail>, String> {
    if !is_mbid(album_id) {
        return Err("Identifiant d'album invalide.".to_string());
    }
    let inc = "recordings+artist-credits+isrcs+release-groups";
    let official = http_get(&format!("release?release-group={album_id}&status=official&inc={inc}&limit=15&fmt=json"))?;
    if let Some(detail) = parse_album_detail(&official, album_id)? {
        return Ok(Some(detail));
    }
    // Aucune édition « officielle » avec pistes : on accepte les autres statuts.
    let any = http_get(&format!("release?release-group={album_id}&inc={inc}&limit=15&fmt=json"))?;
    parse_album_detail(&any, album_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rec_search() -> Value {
        json!({
          "created": "2026-11-13T10:00:00.000Z", "count": 3, "offset": 0,
          "recordings": [
            { "id": "11111111-1111-1111-1111-111111111111", "score": 100,
              "title": "One More Time", "length": 320357,
              "artist-credit": [{ "name": "Daft Punk", "joinphrase": "",
                                  "artist": { "id": "22222222-2222-2222-2222-222222222222", "name": "Daft Punk" } }],
              "first-release-date": "2000-11-13",
              "isrcs": ["GBDUW0000059"],
              "releases": [
                { "id": "r-live", "title": "Alive 2007", "status": "Official", "date": "2007-11-19",
                  "release-group": { "id": "33333333-3333-3333-3333-333333333333", "primary-type": "Album", "secondary-types": ["Live"] } },
                { "id": "r-disc", "title": "Discovery", "status": "Official", "date": "2001-03-12",
                  "release-group": { "id": "44444444-4444-4444-4444-444444444444", "primary-type": "Album", "secondary-types": [] } },
                { "id": "r-promo", "title": "Promo", "status": "Promotion", "date": "2000-01-01",
                  "release-group": { "id": "55555555-5555-5555-5555-555555555555", "primary-type": "Single", "secondary-types": [] } }
              ] },
            { "id": "66666666-6666-6666-6666-666666666666", "score": 95,
              "title": "One More Time (live)", "length": 400000,
              "artist-credit": [{ "name": "Daft Punk", "artist": { "id": "22222222-2222-2222-2222-222222222222", "name": "Daft Punk" } }],
              "releases": [] },
            { "id": "77777777-7777-7777-7777-777777777777", "score": 90,
              "title": "Around the World",
              "artist-credit": [{ "name": "Daft Punk", "joinphrase": " feat. ", "artist": { "id": "22222222-2222-2222-2222-222222222222" } },
                               { "name": "Someone", "artist": { "id": "88888888-8888-8888-8888-888888888888" } }] }
          ]
        })
    }

    #[test]
    fn analyse_une_recherche_de_titres() {
        let raw = parse_track_search(&rec_search()).unwrap();
        assert_eq!(raw.len(), 3);
        let first = &raw[0].track;
        assert_eq!(first.title, "One More Time");
        assert_eq!(first.artist, "Daft Punk");
        assert_eq!(first.artist_id.as_deref(), Some("22222222-2222-2222-2222-222222222222"));
        assert_eq!(first.duration_ms, Some(320357));
        assert_eq!(first.isrc.as_deref(), Some("GBDUW0000059"));
        // L'édition retenue est l'album studio officiel (pas le live ni la promo).
        assert_eq!(first.album.as_deref(), Some("Discovery"));
        assert_eq!(first.album_id.as_deref(), Some("44444444-4444-4444-4444-444444444444"));
        assert_eq!(first.year, Some(2001));
        assert!(first.cover_url.as_deref().unwrap().ends_with("/release-group/44444444-4444-4444-4444-444444444444/front-250"));
        // Crédits multiples recomposés avec leur jointure.
        assert_eq!(raw[2].track.artist, "Daft Punk feat. Someone");
        assert_eq!(raw[1].track.album, None);
        assert_eq!(raw[1].track.cover_url, None);
    }

    #[test]
    fn analyse_les_artistes() {
        let value = json!({ "artists": [
            { "id": "a1", "name": "Daft Punk", "type": "Group", "score": 100, "country": "FR",
              "disambiguation": "", "life-span": { "begin": "1993", "end": "2021-02-22", "ended": true } },
            { "id": "a2", "name": "Etienne Daho", "type": "Person", "score": 80, "life-span": { "begin": "1981" } },
            { "id": "a3", "name": "Inconnu" }
        ]});
        let raw = parse_artist_search(&value).unwrap();
        assert_eq!(raw[0].artist.active_years.as_deref(), Some("1993 – 2021"));
        assert_eq!(raw[0].artist.disambiguation, None);
        assert_eq!(raw[1].artist.active_years.as_deref(), Some("depuis 1981"));
        assert_eq!(raw[2].artist.kind, None);
        assert_eq!(raw[2].mb_score, 0);
    }

    #[test]
    fn analyse_les_albums_et_leur_type() {
        let value = json!({ "release-groups": [
            { "id": "g1", "title": "Discovery", "primary-type": "Album", "secondary-types": [],
              "first-release-date": "2001-03-12", "score": 100,
              "artist-credit": [{ "name": "Daft Punk", "artist": { "id": "a1", "name": "Daft Punk" } }] },
            { "id": "g2", "title": "Alive 2007", "primary-type": "Album", "secondary-types": ["Live"],
              "first-release-date": "2007", "artist-credit": [] },
            { "id": "g3", "title": "Truc", "first-release-date": "" }
        ]});
        let raw = parse_release_groups(&value).unwrap();
        assert_eq!(raw[0].album.kind, "album");
        assert_eq!(raw[0].album.year, Some(2001));
        assert_eq!(raw[1].album.secondary_types, vec!["Live".to_string()]);
        assert_eq!(raw[1].album.year, Some(2007));
        assert_eq!(raw[2].album.kind, "autre");
        assert_eq!(raw[2].album.year, None);
    }

    fn album_release() -> Value {
        json!({ "releases": [
          { "id": "deluxe", "title": "Discovery (Deluxe)", "status": "Official", "date": "2010-05-01",
            "artist-credit": [{ "name": "Daft Punk", "artist": { "id": "a1", "name": "Daft Punk" } }],
            "release-group": { "id": "g1", "title": "Discovery", "primary-type": "Album", "secondary-types": [] },
            "media": [{ "position": 1, "tracks": [ { "id": "t1", "title": "x", "length": 1000 }, { "id": "t2", "title": "y" }, { "id": "t3", "title": "z" } ] }] },
          { "id": "std", "title": "Discovery", "status": "Official", "date": "2001-03-12",
            "artist-credit": [{ "name": "Daft Punk", "artist": { "id": "a1", "name": "Daft Punk" } }],
            "release-group": { "id": "g1", "title": "Discovery", "primary-type": "Album", "secondary-types": [] },
            "media": [
              { "position": 1, "tracks": [
                { "id": "tr1", "number": "1", "title": "One More Time", "length": 320357,
                  "recording": { "id": "rec1", "title": "One More Time", "length": 320357, "isrcs": ["GBDUW0000059"],
                                 "artist-credit": [{ "name": "Daft Punk", "artist": { "id": "a1", "name": "Daft Punk" } }] } },
                { "id": "tr2", "title": "Aerodynamic",
                  "recording": { "id": "rec2", "title": "Aerodynamic", "length": 212000, "artist-credit": [] } } ] },
              { "position": 2, "tracks": [ { "id": "tr3", "title": "Bonus", "recording": { "id": "rec3" } } ] }
            ] },
          { "id": "empty", "title": "Sans pistes", "status": "Official", "date": "1999-01-01", "media": [] }
        ]})
    }

    #[test]
    fn analyse_les_pistes_d_un_album_en_choisissant_l_edition_standard() {
        let detail = parse_album_detail(&album_release(), "g1").unwrap().expect("album");
        assert_eq!(detail.album.title, "Discovery");
        assert_eq!(detail.album.artist, "Daft Punk");
        assert_eq!(detail.album.year, Some(2001)); // édition d'origine, pas la deluxe de 2010
        assert_eq!(detail.tracks.len(), 3);
        assert_eq!(detail.tracks[0].id, "rec1");
        assert_eq!(detail.tracks[0].position, Some(1));
        assert_eq!(detail.tracks[0].isrc.as_deref(), Some("GBDUW0000059"));
        assert_eq!(detail.tracks[0].duration_ms, Some(320357));
        // Crédit absent sur la piste : repli sur l'artiste de l'album.
        assert_eq!(detail.tracks[1].artist, "Daft Punk");
        assert_eq!(detail.tracks[1].duration_ms, Some(212000));
        // Les disques suivants continuent la numérotation.
        assert_eq!(detail.tracks[2].position, Some(3));
        assert_eq!(detail.tracks[2].album_id.as_deref(), Some("g1"));
    }

    #[test]
    fn un_album_sans_pistes_donne_none() {
        let value = json!({ "releases": [ { "id": "x", "media": [] } ] });
        assert!(parse_album_detail(&value, "g1").unwrap().is_none());
        assert!(parse_album_detail(&json!({}), "g1").unwrap().is_none());
        assert!(parse_album_detail(&Value::Null, "g1").unwrap().is_none());
        // Un 404 (valeur `null`) donne des listes vides, jamais une erreur.
        assert!(parse_track_search(&Value::Null).unwrap().is_empty());
        assert!(parse_artist_search(&Value::Null).unwrap().is_empty());
        assert!(parse_release_groups(&Value::Null).unwrap().is_empty());
    }

    #[test]
    fn construit_des_requetes_lucene_sures() {
        assert_eq!(clean_query("AC/DC: \"Back\" (in) Black!"), "AC DC Back in Black");
        assert_eq!(track_query("daft punk one more time"), "recording:(daft punk one more time) OR artist:(daft punk one more time)");
        assert_eq!(track_query("Daft Punk - One More Time"), "recording:\"One More Time\" AND artist:\"Daft Punk\"");
        assert_eq!(album_query("Daft Punk – Discovery"), "releasegroup:\"Discovery\" AND artist:\"Daft Punk\"");
        assert_eq!(artist_query("Étienne Daho"), "artist:(Étienne Daho)");
        // Tiret sans espaces : pas un séparateur artiste/titre.
        assert_eq!(track_query("Week-end"), "recording:(Week end) OR artist:(Week end)");
        assert_eq!(percent_encode("a b&c\"é"), "a%20b%26c%22%C3%A9");
    }

    #[test]
    fn les_erreurs_de_saisie_et_de_type_sont_refusees_sans_reseau() {
        assert!(search("track", "   ").is_err());
        assert!(search("track", "(*)").is_err());
        assert!(search("playlist", "daft punk").is_err());
        assert!(artist_albums("../etc/passwd").is_err());
        assert!(album_tracks("pas-un-mbid").is_err());
    }
}
