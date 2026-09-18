//! Signal de repli tiré de la hiérarchie de dossiers, en complément de
//! `filename` — corrige un angle mort de l'Étape 4 (doc §6.3, erratum) :
//! `filename::parse` n'analyse que le nom du fichier lui-même, si bien
//! qu'une bibliothèque organisée selon la convention `Titre/Saison NN/
//! fichier` (Jellyfin/Kodi/Plex — c'est aussi celle de l'exemple qui a
//! motivé ce correctif) ne pouvait pas être regroupée sous un seul Titre
//! quand les fichiers ne répètent pas eux-mêmes le titre et le numéro de
//! saison (ex. "Episode 01.mkv" dans un dossier "S1").
//!
//! Priorité au signal du fichier quand il existe : ce module n'intervient
//! que si `filename::parse` n'a trouvé aucun numéro de saison (voir
//! `mod::match_library`). Il ne modifie jamais le numéro d'épisode — la
//! logique existante (numéro trouvé dans le fichier, sinon numéro suivant
//! disponible dans la Saison) reste inchangée et suffisante ici.

use super::filename::clean_title;
use regex::Regex;
use std::path::Path;
use std::sync::OnceLock;

pub struct PathHint {
    pub title_guess: String,
    pub season_number: i32,
}

fn season_folder_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    // Dossier entièrement dédié à l'indication de saison ("S1", "S01",
    // "Saison 1", "Season 01"...) — ancré sur toute la chaîne pour éviter
    // un faux positif sur un dossier dont le nom contient incidemment ces
    // mots (ex. "Season of Love").
    PATTERN.get_or_init(|| Regex::new(r"(?i)^(?:saison|season|s)[ _.\-]?(\d{1,3})$").unwrap())
}

/// Cherche un dossier de saison parmi les parents de `full_path` et, s'il
/// en trouve un, remonte encore d'un niveau pour en déduire le Titre.
///
/// `library_roots` borne la remontée : si le dossier candidat pour le
/// Titre est en réalité la racine de la bibliothèque elle-même (cas d'une
/// bibliothèque dédiée à un seul Titre, dossiers de saison directement à
/// sa racine), son nom n'a aucune raison de correspondre au Titre — mieux
/// vaut ne pas deviner que deviner faux.
pub fn detect(full_path: &str, library_roots: &[String]) -> Option<PathHint> {
    let path = Path::new(full_path);
    let season_dir = path.parent()?.file_name()?.to_str()?;
    let season_number = season_folder_pattern()
        .captures(season_dir)
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<i32>().ok())?;

    let title_dir_path = path.parent()?.parent()?;
    if library_roots.iter().any(|root| Path::new(root) == title_dir_path) {
        return None;
    }

    let title_dir_name = title_dir_path.file_name()?.to_str()?;
    let title_guess = clean_title(title_dir_name);
    if title_guess.is_empty() {
        return None;
    }

    Some(PathHint {
        title_guess,
        season_number,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn detects_season_and_title_from_folder_convention() {
        let hint = detect(
            "/media/Anime/Mushoku Tensei/S1/Episode 01.mkv",
            &roots(&["/media/Anime"]),
        )
        .expect("un signal de dossier devrait être détecté");

        assert_eq!(hint.title_guess, "Mushoku Tensei");
        assert_eq!(hint.season_number, 1);
    }

    #[test]
    fn recognizes_french_and_english_season_folder_names() {
        for folder in ["S2", "S02", "Saison 2", "Season 02", "Season_02"] {
            let path = format!("/media/Anime/Mushoku Tensei/{folder}/ep.mkv");
            let hint = detect(&path, &roots(&["/media/Anime"]))
                .unwrap_or_else(|| panic!("devrait détecter une saison pour {folder}"));
            assert_eq!(hint.season_number, 2, "dossier testé : {folder}");
        }
    }

    #[test]
    fn returns_none_without_a_recognizable_season_folder() {
        let hint = detect("/media/Anime/Mushoku Tensei/Episode 01.mkv", &roots(&["/media/Anime"]));
        assert!(hint.is_none());
    }

    #[test]
    fn returns_none_when_the_title_folder_is_the_library_root() {
        // Bibliothèque dédiée à un seul Titre : "S1" est directement à la
        // racine de la bibliothèque, pas de dossier de Titre au-dessus.
        let hint = detect(
            "/media/Mushoku Tensei/S1/Episode 01.mkv",
            &roots(&["/media/Mushoku Tensei"]),
        );
        assert!(hint.is_none());
    }

    #[test]
    fn does_not_confuse_an_unrelated_folder_name_with_a_season() {
        let hint = detect(
            "/media/Anime/Some Show/Season of Love/ep.mkv",
            &roots(&["/media/Anime"]),
        );
        assert!(hint.is_none());
    }
}
