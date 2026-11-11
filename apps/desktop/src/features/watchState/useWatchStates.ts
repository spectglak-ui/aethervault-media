import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  WATCH_STATE_EVENT,
  watchStateApi,
  type MediaWatchState,
  type ResumeTarget,
  type TitleWatchState,
} from "./api";

/** Délai de regroupement : une rafale d'événements ne déclenche qu'un rechargement. */
const REFRESH_DEBOUNCE_MS = 350;

/**
 * Charge `fetcher(ids)` et recharge à chaque changement de statut (lecture,
 * marquage manuel). L'effet ne se relance que si la LISTE d'ids change vraiment
 * (clé stable), et l'ancien résultat reste affiché pendant un rechargement
 * pour éviter tout clignotement des pastilles.
 */
function useWatchQuery<T>(
  ids: number[] | null,
  fetcher: (ids: number[]) => Promise<T[]>,
  idOf: (row: T) => number
): Record<number, T> {
  const [rows, setRows] = useState<Record<number, T>>({});
  const key = ids === null ? "" : ids.join(",");
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const idOfRef = useRef(idOf);
  idOfRef.current = idOf;

  useEffect(() => {
    if (ids === null || ids.length === 0) {
      setRows({});
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const load = () => {
      fetcherRef
        .current(ids)
        .then((result) => {
          if (!alive) return;
          const map: Record<number, T> = {};
          for (const row of result) map[idOfRef.current(row)] = row;
          setRows(map);
        })
        .catch(() => {});
    };
    load();
    const unlisten = listen(WATCH_STATE_EVENT, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      void unlisten.then((stop) => stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return rows;
}

/** Statuts d'une liste de titres (grilles d'affiches), indexés par id de titre. */
export function useTitleWatchStates(titleIds: number[] | null): Record<number, TitleWatchState> {
  return useWatchQuery(titleIds, watchStateApi.listTitleStates, (row) => row.title_id);
}

/** Statuts d'une liste de fichiers (épisodes d'une saison, film), indexés par id de fichier. */
export function useMediaWatchStates(
  mediaFileIds: number[] | null
): Record<number, MediaWatchState> {
  return useWatchQuery(mediaFileIds, watchStateApi.listMediaStates, (row) => row.media_file_id);
}

/** Épisode à proposer pour « Continuer » une série (`null` : tout vu ou pas une série). */
export function useResumeTarget(titleId: number | null): ResumeTarget | null {
  const [target, setTarget] = useState<ResumeTarget | null>(null);

  useEffect(() => {
    if (titleId === null) {
      setTarget(null);
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const load = () => {
      watchStateApi
        .getResumeTarget(titleId)
        .then((result) => {
          if (alive) setTarget(result);
        })
        .catch(() => {});
    };
    load();
    const unlisten = listen(WATCH_STATE_EVENT, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      void unlisten.then((stop) => stop());
    };
  }, [titleId]);

  return target;
}
