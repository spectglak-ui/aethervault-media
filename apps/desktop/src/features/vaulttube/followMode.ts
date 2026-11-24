import { vaultTubeApi, type VaultTubeSubscription } from "./api";

type PlaybackMode = VaultTubeSubscription["mode"];

/**
 * Suit une chaîne ou une playlist DANS le mode de la page courante.
 *
 * Le mode est transmis au backend, qui crée l'abonnement directement dans le bon espace
 * (Musique = « audio », Vidéo = « video ») : plus d'abonnement créé « vidéo » puis basculé
 * dans un second appel, qui restait invisible dans Musique si le second appel n'avait pas lieu.
 * Une même playlist peut être suivie dans les deux espaces ; la suivre deux fois dans le même
 * espace renvoie simplement l'abonnement existant.
 */
export async function addSubscriptionInMode(
  url: string,
  mode: PlaybackMode | undefined
): Promise<VaultTubeSubscription> {
  return vaultTubeApi.addSubscription(url, mode);
}

const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];

/** Identifiant de playlist YouTube (`list=`) d'une adresse, ou `null` (même règle que le backend). */
export function youtubePlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (!YOUTUBE_HOSTS.includes(parsed.hostname.toLowerCase())) return null;
    const id = parsed.searchParams.get("list");
    return id && /^[A-Za-z0-9_-]{2,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Identifiants des playlists déjà suivies dans un mode (pour afficher « Suivie »). */
export function followedPlaylistIds(
  subscriptions: VaultTubeSubscription[],
  mode: PlaybackMode | undefined
): Set<string> {
  const ids = new Set<string>();
  for (const s of subscriptions) {
    if (s.kind !== "playlist" || (mode && s.mode !== mode)) continue;
    ids.add(youtubePlaylistId(s.url) ?? s.youtube_id);
  }
  return ids;
}
