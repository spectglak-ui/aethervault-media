import type { PlayableMedia } from "@aethervault/shared-types";

/**
 * Préchargement du média suivant (AetherFy Vidéo et AetherFy Musique se règlent séparément).
 * Les réglages sont dans le navigateur (localStorage), activés par défaut.
 */
export interface PrefetchSettings {
  /** Films, séries, vidéos AetherFy : flux vidéo (ou fichier local) du média suivant. */
  video: boolean;
  /** AetherFy Musique : flux audio de la piste suivante. */
  music: boolean;
}

export type PrefetchKind = keyof PrefetchSettings;

const STORAGE_KEYS: Record<PrefetchKind, string> = {
  video: "avm-prefetch-video",
  music: "avm-prefetch-music",
};

export function loadPrefetchSettings(): PrefetchSettings {
  const read = (kind: PrefetchKind): boolean => {
    try {
      return localStorage.getItem(STORAGE_KEYS[kind]) !== "0"; // activé tant qu'on ne l'a pas coupé
    } catch {
      return true;
    }
  };
  return { video: read("video"), music: read("music") };
}

export function savePrefetchSetting(kind: PrefetchKind, enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS[kind], enabled ? "1" : "0");
  } catch {
    // best-effort
  }
}

export interface PrefetchTarget {
  path: string;
  /** `true` : piste de Musique (audio seul) ; `false` : vidéo / film. */
  audio: boolean;
}

/**
 * Média à précharger pendant la lecture de `items[currentIndex]`, ou `null`.
 * Pas de préchargement en lecture aléatoire (le suivant n'est tiré qu'au moment de passer) ni
 * quand il n'y a pas de média suivant ; chaque section respecte son propre réglage.
 */
export function prefetchTarget(
  items: readonly PlayableMedia[],
  currentIndex: number | null,
  settings: PrefetchSettings,
  shuffle: boolean
): PrefetchTarget | null {
  if (shuffle || currentIndex === null) return null;
  const next = items[currentIndex + 1];
  if (!next || !next.path) return null;
  const audio = next.mode === "audio";
  if (!(audio ? settings.music : settings.video)) return null;
  return { path: next.path, audio };
}
