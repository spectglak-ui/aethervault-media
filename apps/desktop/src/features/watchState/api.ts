import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

/**
 * Statut de visionnage automatique d'un média ou d'un titre, pour le profil actif.
 * Posé par la lecture elle-même (voir `domain/watch_state.rs`) : tout média est
 * « À voir » au départ, « En cours » une fois commencé, « Vu » une fois terminé
 * (générique de fin compris).
 */
export type WatchState = "todo" | "in_progress" | "done";

export const WATCH_STATE_LABELS: Record<WatchState, string> = {
  todo: "À voir",
  in_progress: "En cours",
  done: "Vu",
};

/** Statut d'un titre ; pour une série `watched`/`total` comptent les épisodes. */
export interface TitleWatchState {
  title_id: number;
  status: WatchState;
  watched: number;
  total: number;
}

/** Statut d'un fichier (film ou épisode) + avancement s'il est « En cours ». */
export interface MediaWatchState {
  media_file_id: number;
  status: WatchState;
  /** Fraction 0–1 de la position de reprise (seulement si « En cours »). */
  progress_ratio: number | null;
  position_seconds: number | null;
}

/** Épisode à proposer pour « Continuer » une série. */
export interface ResumeTarget {
  media_file_id: number;
  episode_id: number;
  season_id: number;
  season_number: number;
  episode_number: number;
  status: WatchState;
  resume_seconds: number | null;
}

/** Événement émis à chaque changement de statut (lecture, marquage manuel). */
export const WATCH_STATE_EVENT = "watch-state:changed";

export function notifyWatchStateChanged(): void {
  emit(WATCH_STATE_EVENT).catch(() => {});
}

export const watchStateApi = {
  /** Plusieurs titres en une requête (grilles) ; tous les ids demandés sont renvoyés. */
  listTitleStates: (titleIds: number[]) =>
    invoke<TitleWatchState[]>("list_title_watch_states", { titleIds }),
  /** Plusieurs fichiers en une requête (listes d'épisodes, page d'un film). */
  listMediaStates: (mediaFileIds: number[]) =>
    invoke<MediaWatchState[]>("list_media_watch_states", { mediaFileIds }),
  /** Marquage manuel d'un fichier : « Vu » ou « À voir » (efface la reprise). */
  setMediaStatus: (mediaFileId: number, status: "done" | "todo") =>
    invoke<void>("set_media_watch_status", { mediaFileId, status }).then(notifyWatchStateChanged),
  /** Marquage manuel d'un titre entier (film, ou tous les épisodes d'une série). */
  setTitleStatus: (titleId: number, status: "done" | "todo") =>
    invoke<void>("set_title_watch_status", { titleId, status }).then(notifyWatchStateChanged),
  /** Épisode à proposer pour « Continuer » (`null` si tout est vu). */
  getResumeTarget: (titleId: number) =>
    invoke<ResumeTarget | null>("get_title_resume_target", { titleId }),
};
