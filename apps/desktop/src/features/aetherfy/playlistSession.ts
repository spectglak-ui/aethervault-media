import type { VaultTubeVideo } from "../vaulttube/api";

/**
 * Playlist EN COURS DE LECTURE dans AetherFy quand elle n'existe pas en base
 * (playlist publique d'une chaîne, lue en direct). La page de lecture y puise
 * la liste affichée à droite : SEULEMENT les vidéos de cette playlist, dans son
 * ordre. L'état de navigation ne transporte que la clé (`playlistKey`), pas des
 * milliers de vidéos recopiées à chaque clic dans la liste.
 *
 * Mémoire volatile : après un rechargement de l'application, la clé est
 * inconnue et la page retombe sur son comportement habituel (abonnement).
 */
export interface AfyPlaylistSession {
  key: string;
  title: string;
  videos: VaultTubeVideo[];
}

let current: AfyPlaylistSession | null = null;

export function setPlaylistSession(session: AfyPlaylistSession): void {
  current = session;
}

export function getPlaylistSession(key: string | null | undefined): AfyPlaylistSession | null {
  return key && current && current.key === key ? current : null;
}
