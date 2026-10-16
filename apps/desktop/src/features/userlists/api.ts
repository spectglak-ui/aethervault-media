import { invoke } from "@tauri-apps/api/core";
import type { TitleSummary } from "@aethervault/shared-types";

/** Statut manuel d'un titre de la watchlist. */
export type WatchStatus = "todo" | "in_progress" | "done";

export const WATCH_STATUS_LABELS: Record<WatchStatus, string> = {
  todo: "À voir",
  in_progress: "En cours",
  done: "Vu",
};

/** Note (0,5 à 5 par pas de 0,5) et statut de watchlist d'un titre, pour le profil actif. */
export interface TitleUserState {
  title_id: number;
  rating: number | null;
  watch_status: WatchStatus | null;
}

export interface WatchlistEntry {
  title: TitleSummary;
  status: WatchStatus;
  added_at: string;
  rating: number | null;
}

/** Notes personnelles et watchlist — par profil (voir `commands/user_lists.rs`). */
export const userListsApi = {
  getState: (titleId: number) =>
    invoke<TitleUserState>("get_title_user_state", { titleId }),
  /** Plusieurs titres en une requête ; seuls les titres notés/listés sont renvoyés. */
  listStates: (titleIds: number[]) =>
    invoke<TitleUserState[]>("list_title_user_states", { titleIds }),
  /** `null` retire la note. */
  setRating: (titleId: number, rating: number | null) =>
    invoke<void>("set_title_rating", { titleId, rating }),
  watchlistAdd: (titleId: number) => invoke<void>("watchlist_add", { titleId }),
  watchlistRemove: (titleId: number) => invoke<void>("watchlist_remove", { titleId }),
  watchlistSetStatus: (titleId: number, status: WatchStatus) =>
    invoke<void>("watchlist_set_status", { titleId, status }),
  watchlistList: (categoryId?: number | null, status?: WatchStatus | null) =>
    invoke<WatchlistEntry[]>("watchlist_list", {
      categoryId: categoryId ?? null,
      status: status ?? null,
    }),
};
