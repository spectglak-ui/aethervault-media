import { useEffect, useState } from "react";

/** 0.7.1 — réglage visuel local : masquer le fond des pages Catégorie
 * (Films, Séries, Animés, Documentaires) généré depuis leur vignette/bannière,
 * pour ne laisser que le fond global du logiciel. */
const KEY = "avm-hide-category-backdrop";
export const CATEGORY_BACKDROP_EVENT = "avm-hide-category-backdrop-changed";

export function readCategoryBackdropHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Réactif : se met à jour sans rechargement quand le réglage change
 * depuis les Paramètres (même pattern que avm-home-hide-private). */
export function useCategoryBackdropHidden(): boolean {
  const [hidden, setHidden] = useState(readCategoryBackdropHidden);
  useEffect(() => {
    const sync = () => setHidden(readCategoryBackdropHidden());
    window.addEventListener(CATEGORY_BACKDROP_EVENT, sync);
    return () => window.removeEventListener(CATEGORY_BACKDROP_EVENT, sync);
  }, []);
  return hidden;
}