//! Types échangés avec l'interface (sérialisés en `snake_case`).

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MusicArtist {
    /// MBID MusicBrainz.
    pub id: String,
    pub name: String,
    /// Précision de MusicBrainz pour distinguer les homonymes (« rappeur américain »).
    pub disambiguation: Option<String>,
    pub country: Option<String>,
    /// `Person` | `Group` | …
    pub kind: Option<String>,
    /// Années d'activité lisibles (« 1993 – 2021 »).
    pub active_years: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MusicAlbum {
    /// MBID du « release group » (l'album, toutes éditions confondues).
    pub id: String,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<String>,
    pub year: Option<i32>,
    /// `album` | `single` | `ep` | `autre`
    pub kind: String,
    /// Types secondaires MusicBrainz (`Live`, `Compilation`, `Remix`…), pour ne pas
    /// confondre un album studio et un disque en public.
    pub secondary_types: Vec<String>,
    /// Pochette (Cover Art Archive, chargée à l'affichage — jamais enregistrée).
    pub cover_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MusicTrack {
    /// MBID de l'enregistrement.
    pub id: String,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<String>,
    pub album: Option<String>,
    pub album_id: Option<String>,
    pub year: Option<i32>,
    pub duration_ms: Option<u64>,
    pub isrc: Option<String>,
    pub cover_url: Option<String>,
    /// Rang dans l'album (page d'un album).
    pub position: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MusicAlbumDetail {
    pub album: MusicAlbum,
    pub tracks: Vec<MusicTrack>,
}

/// Réponse de `music_search` : seule la liste du type demandé est renseignée.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct MusicSearchResponse {
    pub kind: String,
    pub artists: Vec<MusicArtist>,
    pub albums: Vec<MusicAlbum>,
    pub tracks: Vec<MusicTrack>,
}

pub fn cover_art_url(release_group_id: &str) -> String {
    format!("https://coverartarchive.org/release-group/{release_group_id}/front-250")
}
