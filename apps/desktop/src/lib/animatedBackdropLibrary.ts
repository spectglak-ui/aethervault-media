/**
0.8.0 — Bibliothèque personnelle de fonds animés.
Les vidéos ajoutées ici (mp4, webm…) sont lues en boucle, muettes,
derrière TOUTE l'interface (AppBackdrop). Stockage localStorage,
comme les autres réglages locaux ; l'événement existant
`avm-home-backdrop-changed` prévient AppBackdrop, le hook
useAnimatedBackdropActive et la section Paramètres.
Priorité d'affichage : vidéo personnelle choisie ICI > vidéo
personnelle historique (commande Rust) > fond animé intégré.
*/
export interface AnimatedBackdropEntry {
  id: string;
  name: string;
  path: string;
}

const LS_LIBRARY = "avm-animated-backdrop-library";
const LS_SELECTED = "avm-animated-backdrop-selected";
export const ANIMATED_BACKDROP_CHANGED = "avm-home-backdrop-changed";

function readLibrary(): AnimatedBackdropEntry[] {
  try {
    const raw = localStorage.getItem(LS_LIBRARY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is AnimatedBackdropEntry =>
        !!e && typeof e === "object" &&
        typeof (e as AnimatedBackdropEntry).id === "string" &&
        typeof (e as AnimatedBackdropEntry).path === "string" &&
        typeof (e as AnimatedBackdropEntry).name === "string"
    );
  } catch {
    return [];
  }
}

function writeLibrary(entries: AnimatedBackdropEntry[]): void {
  try {
    localStorage.setItem(LS_LIBRARY, JSON.stringify(entries));
  } catch {
    // best-effort
  }
  window.dispatchEvent(new Event(ANIMATED_BACKDROP_CHANGED));
}

function baseName(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const cut = Math.max(clean.lastIndexOf("\\"), clean.lastIndexOf("/"));
  const file = cut >= 0 ? clean.slice(cut + 1) : clean;
  return file.replace(/\.[^.]+$/, "") || file;
}

export function getAnimatedBackdropLibrary(): AnimatedBackdropEntry[] {
  return readLibrary();
}

export function addAnimatedBackdrops(paths: string[]): AnimatedBackdropEntry[] {
  const entries = readLibrary();
  const existing = new Set(entries.map((e) => e.path));
  const stamp = Date.now();
  const added: AnimatedBackdropEntry[] = paths
    .filter((p) => p && !existing.has(p))
    .map((p, i) => ({
      id: `${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      name: baseName(p),
      path: p,
    }));
  if (added.length > 0) writeLibrary([...entries, ...added]);
  return readLibrary();
}

export function removeAnimatedBackdrop(id: string): AnimatedBackdropEntry[] {
  const entries = readLibrary().filter((e) => e.id !== id);
  writeLibrary(entries);
  if (getSelectedId() === id) setSelectedId(null);
  return readLibrary();
}

export function getSelectedId(): string | null {
  try {
    return localStorage.getItem(LS_SELECTED);
  } catch {
    return null;
  }
}

export function setSelectedId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(LS_SELECTED);
    else localStorage.setItem(LS_SELECTED, id);
  } catch {
    // best-effort
  }
  window.dispatchEvent(new Event(ANIMATED_BACKDROP_CHANGED));
}

/** Chemin de la vidéo personnelle active (bibliothèque), ou null. */
export function getSelectedCustomPath(): string | null {
  const id = getSelectedId();
  if (!id) return null;
  return readLibrary().find((e) => e.id === id)?.path ?? null;
}