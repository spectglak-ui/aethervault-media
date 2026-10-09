/**
 * Couleurs d'accent des « univers » de l'accueil (portails + graphique de
 * répartition). Format « r, g, b » : utilisé dans `rgba(var(--tint), …)`.
 * Une clé inconnue (catégorie personnalisée future) retombe sur le violet
 * d'AetherVault, jamais sur une valeur invalide.
 */
const TINTS: Record<string, string> = {
  movies: "255, 46, 99",
  series: "124, 92, 255",
  anime: "236, 72, 153",
  animes: "236, 72, 153",
  documentaries: "46, 196, 182",
  reading: "245, 158, 11",
  private: "148, 163, 184",
  tv: "56, 189, 248",
  aetherfy: "124, 92, 255",
};

export const DEFAULT_TINT = "124, 92, 255";

export function tintFor(key: string): string {
  return TINTS[key] ?? DEFAULT_TINT;
}
