//! Catégorie TV (0.9.0) : chaînes de télévision via flux HLS/IPTV publics.
//! Aucun tuner, aucune clé API : des URLs de flux que libmpv lit nativement.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TvChannel {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub logo_url: Option<String>,
    pub group_name: Option<String>,
    pub country: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, Clone)]
pub struct ParsedChannel {
    pub name: String,
    pub url: String,
    pub logo_url: Option<String>,
    pub group_name: Option<String>,
}

/// Extrait un attribut `key="value"` d'une ligne #EXTINF.
fn attr(line: &str, key: &str) -> Option<String> {
    let pat = format!("{key}=\"");
    let start = line.find(&pat)? + pat.len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    let v = &rest[..end];
    if v.is_empty() { None } else { Some(v.to_string()) }
}

/// Nom dérivé d'une URL brute (liste sans #EXTINF).
fn derive_name(url: &str) -> String {
    let seg = url.split('?').next().unwrap_or(url);
    let last = seg.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let stem = last.split('.').next().unwrap_or(last);
    if stem.is_empty() { "Chaîne".to_string() } else { stem.to_string() }
}

/// Parse une playlist M3U/M3U8 (format IPTV standard).
pub fn parse_m3u(text: &str) -> Vec<ParsedChannel> {
    let mut out = Vec::new();
    let mut pending: Option<(String, Option<String>, Option<String>)> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXTINF:") {
            let logo = attr(rest, "tvg-logo");
            let group = attr(rest, "group-title");
            let name = rest.split(',').last().unwrap_or("").trim().to_string();
            let name = if name.is_empty() { "Chaîne".to_string() } else { name };
            pending = Some((name, logo, group));
        } else if !line.starts_with('#') {
            match pending.take() {
                Some((name, logo, group)) => out.push(ParsedChannel {
                    name,
                    url: line.to_string(),
                    logo_url: logo,
                    group_name: group,
                }),
                None => out.push(ParsedChannel {
                    name: derive_name(line),
                    url: line.to_string(),
                    logo_url: None,
                    group_name: None,
                }),
            }
        }
    }
    out
}

/// Télécharge un M3U distant (https) ou lit un fichier local (chemin).
pub fn load_m3u(source: &str) -> Result<String, String> {
    let s = source.trim();
    if s.starts_with("http://") || s.starts_with("https://") {
        ureq::get(s)
            .timeout(std::time::Duration::from_secs(25))
            .call()
            .map_err(|e| format!("Téléchargement M3U impossible : {e}"))?
            .into_string()
            .map_err(|e| e.to_string())
    } else {
        std::fs::read_to_string(s).map_err(|e| format!("Lecture du fichier impossible : {e}"))
    }
}