import { useEffect, useState } from "react";
import { userListsApi, type TitleUserState } from "./api";

/**
 * Notes et statuts de watchlist d'une liste de titres (grilles d'affiches),
 * récupérés en UNE requête et indexés par id de titre. Les titres sans note ni
 * statut sont simplement absents de la table.
 */
export function useTitleUserStates(titleIds: number[] | null): Record<number, TitleUserState> {
  const [states, setStates] = useState<Record<number, TitleUserState>>({});
  // Clé stable : l'effet ne se relance que si la LISTE d'ids change réellement.
  const key = titleIds === null ? "" : titleIds.join(",");

  useEffect(() => {
    if (titleIds === null || titleIds.length === 0) {
      setStates({});
      return;
    }
    let alive = true;
    userListsApi
      .listStates(titleIds)
      .then((rows) => {
        if (!alive) return;
        const map: Record<number, TitleUserState> = {};
        for (const row of rows) map[row.title_id] = row;
        setStates(map);
      })
      .catch(() => {
        if (alive) setStates({});
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return states;
}
