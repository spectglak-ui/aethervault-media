/**
 * Fonds intégrés au logiciel (fichiers livrés dans `public/backdrops/`),
 * proposés dans Paramètres → « Fond de la page d'accueil » et « Fond
 * animé » en plus de l'image / de la vidéo personnelle.
 *
 * Le choix est mémorisé localement (comme les autres préférences
 * d'interface). Un fond personnel (stocké par le backend) garde la
 * priorité s'il existe : les écrans de Paramètres retirent l'un quand ils
 * activent l'autre, pour qu'il n'y ait jamais de doute sur ce qui
 * s'affiche. Les chemins sont relatifs (comme `sounds/yoooo.mp3`) :
 * `public/` est servi à la racine en dev comme en production.
 */
export interface BuiltinBackdrop {
  id: string;
  label: string;
  src: string;
}

export const BUILTIN_IMAGES: readonly BuiltinBackdrop[] = [
  { id: "voie-lactee", label: "Voie lactée", src: "backdrops/voie-lactee.jpg" },
];

export const BUILTIN_VIDEOS: readonly BuiltinBackdrop[] = [
  { id: "ciel-carres", label: "Ciel de carrés", src: "backdrops/ciel-carres.mp4" },
];

const IMAGE_KEY = "avm-builtin-backdrop-image";
const VIDEO_KEY = "avm-builtin-backdrop-video";

/** Valeur stockée quand l'utilisateur RETIRE explicitement le fond intégré :
 *  la distingue de « jamais choisi » (clé absente → fond par défaut). */
const NONE = "none";
/** Fond animé intégré sélectionné tant que l'utilisateur n'a rien choisi. */
const DEFAULT_VIDEO_ID = "ciel-carres";

/** Même événement que celui déjà émis par les sections de Paramètres. */
export const BACKDROP_CHANGED_EVENT = "avm-home-backdrop-changed";

function read(
  key: string,
  list: readonly BuiltinBackdrop[],
  defaultId: string | null
): BuiltinBackdrop | null {
  let id: string | null = null;
  try {
    id = localStorage.getItem(key);
  } catch {
    /* stockage indisponible : on retombe sur le défaut */
  }
  if (id === null) return list.find((b) => b.id === defaultId) ?? null;
  return list.find((b) => b.id === id) ?? null;
}

function write(key: string, id: string | null): void {
  try {
    localStorage.setItem(key, id ?? NONE);
  } catch {
    /* stockage indisponible : le choix n'est simplement pas mémorisé */
  }
  window.dispatchEvent(new Event(BACKDROP_CHANGED_EVENT));
}

export const getBuiltinImage = (): BuiltinBackdrop | null =>
  read(IMAGE_KEY, BUILTIN_IMAGES, null);
export const setBuiltinImage = (id: string | null): void => write(IMAGE_KEY, id);
export const getBuiltinVideo = (): BuiltinBackdrop | null =>
  read(VIDEO_KEY, BUILTIN_VIDEOS, DEFAULT_VIDEO_ID);
export const setBuiltinVideo = (id: string | null): void => write(VIDEO_KEY, id);
