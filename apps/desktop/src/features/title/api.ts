import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  EpisodeSummary,
  SearchFacets,
  TitleDetails,
  TitleSearchQuery,
  TitleSearchResult,
  TitleSummary,
} from "@aethervault/shared-types";

/** Rangée « Continuer à regarder » (Étape 8). */
export interface ContinueWatchingItem {
  mediaFileId: number;
  path: string;
  libraryId: number;
  titleId: number;
  titleName: string;
  kind: string;
  categoryKey: string;
  poster: string | null;
  label: string;
  positionSeconds: number;
  durationSeconds: number;
}

export interface CollectionRecord {
  id: number;
  name: string;
  description: string | null;
  count: number;
}

/** Time Capsule (Étape 8). */
export interface WatchStats {
  totalHours: number;
  sessionCount: number;
  uniqueTitles: number;
  uniqueGenres: number;
}
export interface WatchSession {
  titleId: number;
  titleName: string;
  categoryKey: string;
  poster: string | null;
  positionSeconds: number;
  endedAt: string;
}

export const titleApi = {
  listByCategory: (categoryId: number) =>
    invoke<TitleSummary[]>("list_titles_by_category", { categoryId }),
  getDetails: (titleId: number) => invoke<TitleDetails>("get_title_details", { titleId }),
  listEpisodes: (seasonId: number) => invoke<EpisodeSummary[]>("list_episodes", { seasonId }),
  setPoster: (titleId: number, sourcePath: string | null) =>
    invoke<void>("set_title_poster", { titleId, sourcePath }),
  setBanner: (titleId: number, sourcePath: string | null) =>
    invoke<void>("set_title_banner", { titleId, sourcePath }),
  remove: (titleId: number) => invoke<void>("delete_title", { titleId }),
  recent: () => invoke<TitleSummary[]>("list_recent_titles"),
  hero: () => invoke<TitleDetails | null>("get_home_hero"),
    /** Accueil (Étape 8) : rangée « Continuer à regarder ». */
  continueWatching: () => invoke<ContinueWatchingItem[]>("list_continue_watching"),
  /** Collections (Étape 8). */
  createCollection: (name: string) => invoke<number>("create_collection", { name }),
  listCollections: () => invoke<CollectionRecord[]>("list_collections"),
  deleteCollection: (id: number) => invoke<void>("delete_collection", { id }),
  addToCollection: (collectionId: number, titleId: number) =>
    invoke<void>("add_to_collection", { collectionId, titleId }),
  removeFromCollection: (collectionId: number, titleId: number) =>
    invoke<void>("remove_from_collection", { collectionId, titleId }),
  listCollectionTitles: (collectionId: number) =>
    invoke<TitleSummary[]>("list_collection_titles", { collectionId }),
  listCollectionsForTitle: (titleId: number) => invoke<number[]>("list_collections_for_title", { titleId }),
  search: (query: Partial<TitleSearchQuery>) =>
    invoke<TitleSearchResult[]>("search_titles", { query }),
  facets: () => invoke<SearchFacets>("search_facets"),
      /** Time Capsule (Étape 8). */
  watchStats: () => invoke<WatchStats>("get_watch_stats"),
  topGenres: (limit = 6) => invoke<[string, number][]>("get_top_genres", { limit }),
  topTitles: (limit = 12) => invoke<TitleSummary[]>("get_top_titles", { limit }),
  watchSessions: (from: string, to: string) =>
    invoke<WatchSession[]>("get_watch_sessions", { from, to }),
  similar: (titleId: number, limit = 12) =>
    invoke<TitleSummary[]>("list_similar_titles", { titleId, limit }),
  recordWatch: (mediaFileId: number, positionSeconds: number, durationSeconds: number) =>
    invoke<void>("record_watch", { mediaFileId, positionSeconds, durationSeconds }),
};