/**
 * 0.8.0 — collections locales AetherFy (historique, à regarder plus
 * tard, vidéos aimées) en localStorage : zéro backend, zéro migration.
 * Limite connue : non scopé par profil (comme les réglages player).
 */
export interface AfySavedVideo {
  youtube_id: string;
  source: string;
  title: string;
  thumbnail_url: string | null;
  channel: string | null;
  duration_seconds: number | null;
  added_at: number; // epoch secondes
  added_at: number; // epoch secondes
  plays?: number;   // 0.8.1 : nombre de visionnages (pour la page Tendances)
}

const K_HISTORY = "afy_history_v1";
const K_LATER = "afy_watchlater_v1";
const K_LIKED = "afy_liked_v1";

function read(key: string): AfySavedVideo[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as AfySavedVideo[];
  } catch {
    return [];
  }
}
function write(key: string, list: AfySavedVideo[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

/* ----- Historique ----- */
export function listHistory(): AfySavedVideo[] {
  return read(K_HISTORY);
}
export function addToHistory(v: AfySavedVideo) {
  const list = read(K_HISTORY);
  const existing = list.find((x) => x.youtube_id === v.youtube_id);
  const entry: AfySavedVideo = {
    ...v,
    added_at: Math.floor(Date.now() / 1000),
    plays: (existing?.plays ?? 0) + 1,
  };
  write(
    K_HISTORY,
    [entry, ...list.filter((x) => x.youtube_id !== v.youtube_id)].slice(0, 300)
  );
}
export function removeFromHistory(youtubeId: string) {
  write(K_HISTORY, read(K_HISTORY).filter((x) => x.youtube_id !== youtubeId));
}
export function clearHistory() {
  write(K_HISTORY, []);
}

/* ----- À regarder plus tard ----- */
export function listWatchLater(): AfySavedVideo[] {
  return read(K_LATER);
}
export function isInWatchLater(youtubeId: string): boolean {
  return read(K_LATER).some((x) => x.youtube_id === youtubeId);
}
export function toggleWatchLater(v: AfySavedVideo): boolean {
  const list = read(K_LATER);
  const has = list.some((x) => x.youtube_id === v.youtube_id);
  write(K_LATER, has ? list.filter((x) => x.youtube_id !== v.youtube_id) : [{ ...v, added_at: Math.floor(Date.now() / 1000) }, ...list]);
  return !has;
}

/* ----- Vidéos aimées ----- */
export function listLiked(): AfySavedVideo[] {
  return read(K_LIKED);
}
export function isInLiked(youtubeId: string): boolean {
  return read(K_LIKED).some((x) => x.youtube_id === youtubeId);
}
export function toggleLiked(v: AfySavedVideo): boolean {
  const list = read(K_LIKED);
  const has = list.some((x) => x.youtube_id === v.youtube_id);
  write(K_LIKED, has ? list.filter((x) => x.youtube_id !== v.youtube_id) : [{ ...v, added_at: Math.floor(Date.now() / 1000) }, ...list]);
  return !has;
}