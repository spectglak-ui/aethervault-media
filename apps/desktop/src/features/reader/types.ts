/**
 * Représentation d'une page de livre côté frontend.
 * Adapte ce type à ce que ton `readingApi.listPages(bookId)` renvoie.
 */
export interface ReadingPage {
  id: number;
  path: string; // chemin absolu (sera passé à convertFileSrc)
  pageNumber: number; // 1-based pour l'affichage
}

export type ReadingDisplayMode = "spread" | "simple" | "scroll";