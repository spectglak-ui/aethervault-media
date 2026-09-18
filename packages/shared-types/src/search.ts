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