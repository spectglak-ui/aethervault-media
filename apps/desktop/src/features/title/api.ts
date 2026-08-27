import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  EpisodeSummary,
  SearchFacets,
  TitleDetails,
  TitleSearchQuery,
  TitleSearchResult,
  TitleSummary,
} from "@aethervault/shared-types";

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
  search: (query: Partial<TitleSearchQuery>) =>
    invoke<TitleSearchResult[]>("search_titles", { query }),
  facets: () => invoke<SearchFacets>("search_facets"),
};