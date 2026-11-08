import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Clés YouTube de la bande-annonce d'un titre (mêmes sources que la fiche du
 * titre : TMDB d'abord, recherche par nom en secours). `null` tant que rien
 * n'est connu ou que la fonction est désactivée ; `[]` si aucune n'existe.
 */
export function useHeroTrailerKeys(
  titleId: number | null,
  titleName: string | null,
  enabled: boolean
): string[] | null {
  const [keys, setKeys] = useState<string[] | null>(null);
  useEffect(() => {
    setKeys(null);
    if (!enabled || titleId === null) return;
    let alive = true;
    const fallback = async (): Promise<string[]> => {
      if (!titleName) return [];
      try {
        const id = await invoke<string | null>("player_find_trailer", { title: titleName });
        return id ? [id] : [];
      } catch {
        return [];
      }
    };
    invoke<string[]>("get_title_trailer", { titleId })
      .then((found) => (found && found.length > 0 ? found : fallback()))
      .catch(() => fallback())
      .then((found) => {
        if (alive) setKeys(found);
      });
    return () => {
      alive = false;
    };
  }, [titleId, titleName, enabled]);
  return keys;
}
