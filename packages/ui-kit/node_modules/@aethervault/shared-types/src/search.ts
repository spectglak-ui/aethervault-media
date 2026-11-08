/** Explorateur (Étape 7) — miroirs de la recherche multicritère Rust. */
export interface TitleSearchQuery {
  q?: string | null;
  category_keys: string[];
  kinds: string[];
  year_from?: number | null;
  year_to?: number | null;
  genres: string[];
  actor?: string | null;
  director?: string | null;
  resolutions: string[];
  codecs: string[];
  audio_langs: string[];
  /** Sagas (collections TMDB) — noms exacts, OU interne. */
  sagas: string[];
}

export interface TitleSearchResult {
  id: number;
  category_id: number;
  category_key: string;
  category_name: string;
  kind: string;
  name: string;
  year: number | null;
  poster: string | null;
  rating: number | null;
}

export interface SearchFacets {
  genres: string[];
  resolutions: string[];
  codecs: string[];
  audio_langs: string[];
}

/** Une valeur de facette et le nombre de titres qui la portent. */
export interface FacetCount {
  value: string;
  count: number;
}

/** Compteurs de toutes les facettes pour un périmètre de catégories. */
export interface FacetCounts {
  total: number;
  year_min: number | null;
  year_max: number | null;
  genres: FacetCount[];
  /** `value` = début de décennie (« 1990 »). */
  decades: FacetCount[];
  resolutions: FacetCount[];
  codecs: FacetCount[];
  audio_langs: FacetCount[];
  sagas: FacetCount[];
  directors: FacetCount[];
  actors: FacetCount[];
}

export type SmartCollectionKind =
  | "saga"
  | "genre"
  | "director"
  | "actor"
  | "studio"
  | "decade"
  | "quality"
  | "rating";

/** Collection calculée automatiquement à partir du catalogue. */
export interface SmartCollection {
  kind: SmartCollectionKind;
  key: string;
  name: string;
  count: number;
  /** Jusqu'à 4 affiches (chemins locaux) pour la mosaïque de couverture. */
  posters: string[];
}

export interface SagaStatus {
  unchecked: number;
  tmdb_configured: boolean;
  running: boolean;
}
