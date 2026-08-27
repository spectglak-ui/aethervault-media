import { invoke } from "@tauri-apps/api/core";
import type {
  EpisodeSummary,
  SearchFacets,
  TitleDetails,
  TitleSearchQuery,
  TitleSearchResult,
  TitleSummary,
} from "@aethervault/shared-types";

/**
 * Point d'accès unique aux commandes backend liées au contenu
 * (Titre/Saison/Épisode, doc §6.3). Les pages n'appellent jamais `invoke`
 * directement.
 */
export const titleApi = {
  listByCategory: (categoryId: number) =>
    invoke<TitleSummary[]>("list_titles_by_category", { categoryId }),
  getDetails: (titleId: number) => invoke<TitleDetails>("get_title_details", { titleId }),
  listEpisodes: (seasonId: number) => invoke<EpisodeSummary[]>("list_episodes", { seasonId }),
  /** `sourcePath` à `null` efface la personnalisation (doc §6.6). */
  setPoster: (titleId: number, sourcePath: string | null) =>
    invoke<void>("set_title_poster", { titleId, sourcePath }),
  setBanner: (titleId: number, sourcePath: string | null) =>
    invoke<void>("set_title_banner", { titleId, sourcePath }),
  /** Ne touche jamais aux fichiers média sur le disque (doc §8, Étape 5). */
  remove: (titleId: number) => invoke<void>("delete_title", { titleId }),
  /** Explorateur (Étape 7) : recherche multicritère + valeurs de filtres. */
  search: (query: Partial<TitleSearchQuery>) =>
    invoke<TitleSearchResult[]>("search_titles", { query }),
  facets: () => invoke<SearchFacets>("search_facets"),
};