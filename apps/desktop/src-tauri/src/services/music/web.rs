//! Recherches YouTube complémentaires du catalogue : playlists et livres audio.
//!
//! La recherche texte de base (`ytsearch`) ne renvoie que des vidéos. Les
//! playlists s'obtiennent avec le filtre « Playlist » des résultats YouTube
//! (paramètre `sp`), que yt-dlp sait lire ; les livres audio sont des vidéos
//! longues retrouvées par mots-clés. L'analyse des réponses est séparée du
//! lancement de yt-dlp pour être testée sans réseau.

use serde_json::Value;

use crate::services::vaulttube::models::SearchResult;

/// Filtre « Type : Playlist » des résultats de recherche YouTube.
const PLAYLIST_FILTER: &str = "EgIQAw%253D%253D";
/// Un livre audio dure au moins 30 minutes.
pub const AUDIOBOOK_MIN_SECONDS: i64 = 30 * 60;

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

/// Adresse de la recherche YouTube limitée aux playlists.
pub fn playlist_search_url(query: &str) -> String {
    format!(
        "https://www.youtube.com/results?search_query={}&sp={PLAYLIST_FILTER}",
        percent_encode(query.trim())
    )
}

/// Playlists « réelles » : listes d'utilisateurs (`PL…`), albums YouTube Music
/// (`OLAK5uy…`) et favoris publics (`FL…`). Les « mixes » (`RD…`), générés à la
/// volée et sans contenu fixe, sont ignorés.
fn is_playlist_id(id: &str) -> bool {
    ["PL", "OLAK5uy", "FL"].iter().any(|p| id.starts_with(p))
}

fn thumbnail(entry: &Value) -> Option<String> {
    entry
        .get("thumbnail")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            entry
                .get("thumbnails")
                .and_then(Value::as_array)
                .and_then(|list| list.last())
                .and_then(|t| t.get("url"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

/// Interprète une ligne JSON (`--flat-playlist --dump-json`) de la recherche de
/// playlists ; `None` si ce n'est pas une playlist exploitable.
pub fn parse_playlist_line(line: &str) -> Option<SearchResult> {
    let entry: Value = serde_json::from_str(line).ok()?;
    let id = entry.get("id")?.as_str()?;
    let title = entry.get("title")?.as_str()?.trim();
    if id.is_empty() || title.is_empty() || !is_playlist_id(id) {
        return None;
    }
    let url = entry
        .get("url")
        .and_then(Value::as_str)
        .filter(|u| u.contains("list="))
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://www.youtube.com/playlist?list={id}"));
    let count = ["playlist_count", "video_count", "n_entries"]
        .iter()
        .find_map(|k| entry.get(*k).and_then(Value::as_i64))
        .filter(|n| *n > 0);
    Some(SearchResult {
        id: id.to_string(),
        title: title.to_string(),
        url,
        kind: "playlist".to_string(),
        thumbnail_url: thumbnail(&entry),
        channel: entry
            .get("uploader")
            .or_else(|| entry.get("channel"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        duration_seconds: None,
        video_count: count,
        source: "youtube".to_string(),
    })
}

/// Toutes les playlists d'une sortie de yt-dlp (une entrée JSON par ligne), sans doublon.
pub fn parse_playlist_lines(output: &str) -> Vec<SearchResult> {
    let mut seen = std::collections::HashSet::new();
    output
        .lines()
        .filter_map(parse_playlist_line)
        .filter(|r| seen.insert(r.id.clone()))
        .collect()
}

/// Ne garde que les vidéos assez longues pour être des livres audio.
pub fn keep_audiobooks(results: Vec<SearchResult>) -> Vec<SearchResult> {
    let mut seen = std::collections::HashSet::new();
    results
        .into_iter()
        .filter(|r| r.kind == "video" && r.duration_seconds.is_some_and(|d| d >= AUDIOBOOK_MIN_SECONDS))
        .filter(|r| seen.insert(r.id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(id: &str, seconds: Option<i64>, kind: &str) -> SearchResult {
        SearchResult {
            id: id.into(),
            title: format!("Titre {id}"),
            url: format!("https://www.youtube.com/watch?v={id}"),
            kind: kind.into(),
            thumbnail_url: None,
            channel: None,
            duration_seconds: seconds,
            video_count: None,
            source: "youtube".into(),
        }
    }

    #[test]
    fn construit_l_adresse_de_recherche_de_playlists() {
        assert_eq!(
            playlist_search_url("  chain of the abyss "),
            "https://www.youtube.com/results?search_query=chain%20of%20the%20abyss&sp=EgIQAw%253D%253D"
        );
        assert!(playlist_search_url("AC/DC & co").contains("search_query=AC%2FDC%20%26%20co&"));
    }

    #[test]
    fn analyse_une_playlist_complete() {
        let line = r#"{"id":"PLabc123","title":"Made in Abyss OST","url":"https://www.youtube.com/playlist?list=PLabc123","uploader":"Hecate Music","playlist_count":24,"thumbnails":[{"url":"https://i.ytimg.com/a.jpg"},{"url":"https://i.ytimg.com/b.jpg"}]}"#;
        let r = parse_playlist_line(line).expect("playlist");
        assert_eq!(r.id, "PLabc123");
        assert_eq!(r.kind, "playlist");
        assert_eq!(r.url, "https://www.youtube.com/playlist?list=PLabc123");
        assert_eq!(r.channel.as_deref(), Some("Hecate Music"));
        assert_eq!(r.video_count, Some(24));
        assert_eq!(r.thumbnail_url.as_deref(), Some("https://i.ytimg.com/b.jpg")); // la plus grande (dernière)
        assert_eq!(r.source, "youtube");
    }

    #[test]
    fn reconstruit_l_url_et_accepte_les_albums_youtube_music() {
        let r = parse_playlist_line(r#"{"id":"OLAK5uy_xyz","title":"Album","thumbnail":"https://i/x.jpg"}"#).unwrap();
        assert_eq!(r.url, "https://www.youtube.com/playlist?list=OLAK5uy_xyz");
        assert_eq!(r.thumbnail_url.as_deref(), Some("https://i/x.jpg"));
        assert_eq!(r.video_count, None);
        // L'adresse d'une vidéo sans « list= » n'est pas reprise telle quelle.
        let r = parse_playlist_line(r#"{"id":"PLz","title":"T","url":"https://www.youtube.com/watch?v=abc"}"#).unwrap();
        assert_eq!(r.url, "https://www.youtube.com/playlist?list=PLz");
    }

    #[test]
    fn ignore_ce_qui_n_est_pas_une_playlist() {
        assert!(parse_playlist_line(r#"{"id":"dQw4w9WgXcQ","title":"Une vidéo"}"#).is_none());
        assert!(parse_playlist_line(r#"{"id":"RDabc","title":"Mix YouTube"}"#).is_none());
        assert!(parse_playlist_line(r#"{"id":"PLabc","title":"  "}"#).is_none());
        assert!(parse_playlist_line(r#"{"title":"Sans id"}"#).is_none());
        assert!(parse_playlist_line("pas du json").is_none());
        assert!(parse_playlist_line("").is_none());
    }

    #[test]
    fn analyse_plusieurs_lignes_sans_doublon() {
        let out = "{\"id\":\"PL1\",\"title\":\"A\"}\n\n{\"id\":\"RD9\",\"title\":\"Mix\"}\n{\"id\":\"PL1\",\"title\":\"A bis\"}\n{\"id\":\"PL2\",\"title\":\"B\"}\n";
        let ids: Vec<String> = parse_playlist_lines(out).into_iter().map(|r| r.id).collect();
        assert_eq!(ids, vec!["PL1", "PL2"]);
    }

    #[test]
    fn les_livres_audio_sont_des_videos_longues() {
        let kept = keep_audiobooks(vec![
            video("a", Some(3600), "video"),
            video("b", Some(240), "video"),
            video("c", None, "video"),
            video("d", Some(7200), "playlist"),
            video("a", Some(3600), "video"),
            video("e", Some(AUDIOBOOK_MIN_SECONDS), "video"),
        ]);
        let ids: Vec<&str> = kept.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "e"]);
    }
}
