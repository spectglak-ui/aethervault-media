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

/** Même événement que celui déjà émis par les sections de Paramètres. */
export const BACKDROP_CHANGED_EVENT = "avm-home-backdrop-changed";

function read(key: string, list: readonly BuiltinBackdrop[]): BuiltinBackdrop | null {
  try {
    const id = localStorage.getItem(key);
    return list.find((b) => b.id === id) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(key);
    else localStorage.setItem(key, id);
  } catch {
    /* stockage indisponible : le choix n'est simplement pas mémorisé */
  }
  window.dispatchEvent(new Event(BACKDROP_CHANGED_EVENT));
}

export const getBuiltinImage = (): BuiltinBackdrop | null => read(IMAGE_KEY, BUILTIN_IMAGES);
export const setBuiltinImage = (id: string | null): void => write(IMAGE_KEY, id);
export const getBuiltinVideo = (): BuiltinBackdrop | null => read(VIDEO_KEY, BUILTIN_VIDEOS);
export const setBuiltinVideo = (id: string | null): void => write(VIDEO_KEY, id);
