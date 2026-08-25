import type { Category } from "@aethervault/shared-types";

/**
 * Route vers laquelle une tuile de catégorie doit naviguer. La catégorie
 * Privé (doc §6.4) ne mène jamais à la grille de Titres habituelle — elle
 * n'a d'ailleurs aucun Titre — mais à un écran d'authentification
 * spécifique. Centralisé ici plutôt que dupliqué dans chaque endroit qui
 * affiche une tuile de catégorie (`HomePage`, `Sidebar`).
 */
export function categoryRoute(category: Pick<Category, "key">): string {
  return category.key === "private" ? "/private" : `/category/${category.key}`;
}
