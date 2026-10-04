import type { Category } from "@aethervault/shared-types";

/**
Construit la route cible d'une catégorie de la sidebar.
0.6.2 : `private` a sa propre page dédiée (`/private`) — la page
`CategoryPage` générique n'est jamais rendue pour cette clé.
0.7.0 : `reading` (Lecture) a également ses propres routes dédiées
(`/reading`, `/reading/library/:id`, `/reading/book/:id`).
*/
export function categoryRoute(category: Pick<Category, "key">): string {
  // 0.7.0 : la catégorie Lecture a ses propres routes dédiées.
  if (category.key === "reading") return "/reading";
  // 0.6.2 : la catégorie Privé a sa propre page dédiée.
  if (category.key === "private") return "/private";
  return `/category/${category.key}`;
}