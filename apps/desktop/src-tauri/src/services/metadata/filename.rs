//! Analyse de noms de fichiers vidéo : détecte saison/épisode et année,
//! nettoie le titre — le strict nécessaire pour un fournisseur qui ne
//! dépend d'aucune source externe (doc §3.4, "fournisseur local/hors
//! ligne"). Conventions reconnues alignées sur celles que documentent
//! Jellyfin/Kodi/Plex pour l'organisation de fichiers, sans prétendre à
//! l'exhaustivité : un futur fournisseur en ligne affine le résultat à
//! partir de cette approximation, ce module n'a qu'à garantir qu'un Titre
//! reçoit toujours un nom exploitable.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedFileName {
    pub title_guess: String,
    pub year: Option<i32>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
}

fn season_episode_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?i)[Ss](\d{1,2})[Ee](\d{1,3})").unwrap())
}

fn year_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    // Entouré d'un séparateur usuel (parenthèse, point, espace) des deux
    // côtés, ou de la fin de chaîne côté droit — évite de confondre une
    // résolution comme "2160p" avec une année (de toute façon hors de la
    // plage 1900-2100 filtrée plus bas, mais autant ne pas la capturer).
    PATTERN.get_or_init(|| Regex::new(r"(?:\(|\.|\s)(\d{4})(?:\)|\.|\s|$)").unwrap())
}

/// Point d'entrée unique de ce module — voir `services::metadata::filename`.
pub fn parse(file_name: &str) -> ParsedFileName {
    let stem = strip_extension(file_name);

    if let Some(caps) = season_episode_pattern().captures(&stem) {
        let full_match = caps.get(0).expect("le groupe 0 existe toujours sur un match réussi");
        let season_number = caps.get(1).and_then(|m| m.as_str().parse().ok());
        let episode_number = caps.get(2).and_then(|m| m.as_str().parse().ok());
        let title_guess = clean_title(&stem[..full_match.start()]);

        return ParsedFileName {
            title_guess,
            year: None,
            season_number,
            episode_number,
        };
    }

    let year = year_pattern()
        .captures(&stem)
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<i32>().ok())
        .filter(|year| (1900..=2100).contains(year));

    let title_guess = match year {
        Some(value) => match stem.find(&value.to_string()) {
            Some(position) => clean_title(&stem[..position]),
            None => clean_title(&stem),
        },
        None => clean_title(&stem),
    };

    ParsedFileName {
        title_guess,
        year,
        season_number: None,
        episode_number: None,
    }
}

fn strip_extension(file_name: &str) -> String {
    match file_name.rfind('.') {
        Some(position) => file_name[..position].to_string(),
        None => file_name.to_string(),
    }
}

/// Remplace points/underscores par des espaces et normalise les espaces —
/// ne tente pas de retirer les nombreuses balises de qualité (1080p,
/// x264, WEB-DL...) de façon exhaustive, ce n'est pas son rôle : un futur
/// fournisseur en ligne affinera ce résultat.
pub(super) fn clean_title(raw: &str) -> String {
    let replaced = raw.replace(['.', '_'], " ");
    let trimmed = replaced
        .trim()
        .trim_matches(|c: char| "-([{".contains(c) || "])}".contains(c))
        .trim();
    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");

    if collapsed.is_empty() {
        raw.trim().to_string()
    } else {
        collapsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_movie_with_year_in_parentheses() {
        let result = parse("Inception (2010).mkv");
        assert_eq!(result.title_guess, "Inception");
        assert_eq!(result.year, Some(2010));
        assert_eq!(result.season_number, None);
    }

    #[test]
    fn parses_movie_with_dotted_tags() {
        let result = parse("The.Matrix.1999.1080p.BluRay.x264.mkv");
        assert_eq!(result.title_guess, "The Matrix");
        assert_eq!(result.year, Some(1999));
    }

    #[test]
    fn parses_series_episode() {
        let result = parse("Breaking.Bad.S01E02.mkv");
        assert_eq!(result.title_guess, "Breaking Bad");
        assert_eq!(result.season_number, Some(1));
        assert_eq!(result.episode_number, Some(2));
    }

    #[test]
    fn falls_back_to_full_name_without_recognizable_pattern() {
        let result = parse("random_home_video.mp4");
        assert_eq!(result.title_guess, "random home video");
        assert_eq!(result.year, None);
        assert_eq!(result.season_number, None);
    }
}
