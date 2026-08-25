//! Fournisseur de métadonnées local/hors-ligne (doc §3.4) — la seule
//! source toujours disponible, sans réseau ni clé d'API. `fetch` ne
//! renvoie jamais `None` : contrairement à un futur fournisseur en ligne,
//! qui peut légitimement ne rien trouver, celui-ci garantit qu'un fichier
//! reçoit toujours au moins un nom de Titre exploitable (le nom de fichier
//! nettoyé), pour qu'aucun média ne reste jamais sans Titre associé.

use super::{FetchedMetadata, MetadataProvider, ParsedQuery};

pub struct LocalProvider;

impl MetadataProvider for LocalProvider {
    fn id(&self) -> &'static str {
        "local"
    }

    fn fetch(&self, query: &ParsedQuery) -> Option<FetchedMetadata> {
        Some(FetchedMetadata {
            name: query.title_guess.clone(),
            description: None,
            year: query.year,
            rating: None,
            genres: Vec::new(),
            studios: Vec::new(),
            cast: Vec::new(),
            directors: Vec::new(),
            poster_path: None,
            banner_path: None,
        })
    }
}
