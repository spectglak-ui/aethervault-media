//! Normalisation de texte pour comparer des titres et des noms d'artistes.

use std::collections::HashSet;

/// Minuscules, accents retirés, ponctuation remplacée par des espaces.
pub fn normalize(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => out.push('a'),
            'ç' | 'Ç' => out.push('c'),
            'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => out.push('e'),
            'ì' | 'í' | 'î' | 'ï' | 'Ì' | 'Í' | 'Î' | 'Ï' => out.push('i'),
            'ñ' | 'Ñ' => out.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ø' => out.push('o'),
            'ù' | 'ú' | 'û' | 'ü' | 'Ù' | 'Ú' | 'Û' | 'Ü' => out.push('u'),
            'ý' | 'ÿ' | 'Ý' => out.push('y'),
            'œ' | 'Œ' => out.push_str("oe"),
            'æ' | 'Æ' => out.push_str("ae"),
            'ß' => out.push_str("ss"),
            c if c.is_alphanumeric() => out.extend(c.to_lowercase()),
            _ => out.push(' '),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn tokens(input: &str) -> Vec<String> {
    normalize(input).split(' ').filter(|t| !t.is_empty()).map(str::to_string).collect()
}

pub fn token_set(input: &str) -> HashSet<String> {
    tokens(input).into_iter().collect()
}

/// Part (0–1) des mots de `wanted` retrouvés dans `haystack` — un mot de 3
/// lettres ou plus compte aussi s'il n'est que le début d'un mot (saisie en cours).
pub fn coverage(wanted: &[String], haystack: &HashSet<String>) -> f64 {
    if wanted.is_empty() {
        return 0.0;
    }
    let found = wanted
        .iter()
        .filter(|w| {
            haystack.contains(*w) || (w.chars().count() >= 3 && haystack.iter().any(|h| h.starts_with(w.as_str())))
        })
        .count();
    found as f64 / wanted.len() as f64
}

/// Retire les mentions entre parenthèses ou crochets (« (Remastered 2011) »,
/// « [Official Video] ») pour comparer le titre « nu ».
pub fn strip_decorations(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut depth = 0usize;
    for c in title.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() { title.trim().to_string() } else { trimmed.to_string() }
}

/// Mots signalant une version « autre » que l'enregistrement d'origine.
pub const VARIANT_WORDS: &[&str] = &[
    "live", "remix", "karaoke", "instrumental", "acoustic", "demo", "cover", "tribute", "slowed",
    "sped", "reverb", "nightcore", "mashup", "medley", "reprise",
];

/// Mots de variante présents dans `text` (triés, sans doublon).
pub fn variants_in(text: &str) -> Vec<&'static str> {
    let set = token_set(text);
    let mut found: Vec<&'static str> = VARIANT_WORDS.iter().copied().filter(|w| set.contains(*w)).collect();
    found.sort_unstable();
    found
}

/// `true` si `id` a la forme d'un MBID (UUID) — évite d'injecter du texte libre
/// dans une URL d'API.
pub fn is_mbid(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalise_accents_casse_et_ponctuation() {
        assert_eq!(normalize("  Étienne Daho — Week-end à Rome! "), "etienne daho week end a rome");
        assert_eq!(normalize("Mylène Farmer ‑ Désenchantée"), "mylene farmer desenchantee");
        assert_eq!(normalize("Cœur de pirate"), "coeur de pirate");
        assert_eq!(normalize("AC/DC"), "ac dc");
    }

    #[test]
    fn couverture_des_mots_avec_debut_de_mot() {
        let hay = token_set("Daft Punk One More Time");
        assert_eq!(coverage(&tokens("daft punk one more time"), &hay), 1.0);
        assert_eq!(coverage(&tokens("daft punk"), &hay), 1.0);
        assert_eq!(coverage(&tokens("daft punk harder"), &hay), 2.0 / 3.0);
        // saisie en cours : « dis » est le début de « discovery »
        assert_eq!(coverage(&tokens("dis"), &token_set("Discovery")), 1.0);
        // un mot de 2 lettres doit être exact
        assert_eq!(coverage(&tokens("on"), &token_set("one")), 0.0);
        assert_eq!(coverage(&[], &hay), 0.0);
    }

    #[test]
    fn retire_les_mentions_entre_parentheses() {
        assert_eq!(strip_decorations("One More Time (Remastered 2011)"), "One More Time");
        assert_eq!(strip_decorations("Song [Official Video] (feat. X)"), "Song");
        assert_eq!(strip_decorations("(Untitled)"), "(Untitled)");
    }

    #[test]
    fn detecte_les_variantes() {
        assert_eq!(variants_in("One More Time (Live at Bercy)"), vec!["live"]);
        assert_eq!(variants_in("Song - Remix Acoustic"), vec!["acoustic", "remix"]);
        assert!(variants_in("One More Time").is_empty());
    }

    #[test]
    fn reconnait_un_mbid() {
        assert!(is_mbid("3bd76d40-7f0e-36b7-9348-91a33afee20e"));
        assert!(!is_mbid("3bd76d40-7f0e-36b7-9348-91a33afee20"));
        assert!(!is_mbid("../../etc/passwd"));
        assert!(!is_mbid("3bd76d40-7f0e-36b7-9348-91a33afee20z"));
    }
}
