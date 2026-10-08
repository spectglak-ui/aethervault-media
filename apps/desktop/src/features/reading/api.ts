import { invoke } from "@tauri-apps/api/core";

export interface ReadingLibrary {
  id: number;
  name: string;
  kind: string; // "manga" | "webtoon" | "bd" | "roman" | "custom"
  icon: string | null;
  accent_color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ReadingFolder {
  id: number;
  library_id: number;
  path: string;
  added_at: string;
}

export interface ReadingBook {
  id: number;
  library_id: number;
  folder_id: number;
  path: string;
  file_name: string;
  format: string;
  title: string;
  series: string | null;
  volume: number | null;
  chapter: string | null;
  page_count: number;
  cover_path: string | null;
  size_bytes: number;
  is_available: boolean;
  modified_at: string;
  discovered_at: string;
}

export interface ReadingProgress {
  book_id: number;
  current_page: number;
  total_pages: number;
  completed: boolean;
  updated_at: string;
}

export interface ContinueReading {
  book: ReadingBook;
  current_page: number;
  total_pages: number;
  completed: boolean;
  updated_at: string;
}

export interface ReadingScanSummary {
  added: number;
  updated: number;
  removed: number;
  failed: number;
}

export type ReadingLibraryKind = "manga" | "webtoon" | "bd" | "roman" | "custom";

export const readingApi = {
  // --- Bibliothèques ---
  listLibraries: () => invoke<ReadingLibrary[]>("reading_list_libraries"),
  createLibrary: (name: string, kind: ReadingLibraryKind) =>
    invoke<number>("reading_create_library", { name, kind }),
  renameLibrary: (libraryId: number, name: string) =>
    invoke<void>("reading_rename_library", { libraryId, name }),
  deleteLibrary: (libraryId: number) =>
    invoke<void>("reading_delete_library", { libraryId }),

  // --- Dossiers sources ---
  addFolder: (libraryId: number, path: string) =>
    invoke<ReadingScanSummary>("reading_add_folder", { libraryId, path }),
  removeFolder: (folderId: number) =>
    invoke<void>("reading_remove_folder", { folderId }),
  scanLibrary: (libraryId: number) =>
    invoke<ReadingScanSummary>("reading_scan_library", { libraryId }),

  // --- Livres ---
  listBooks: (libraryId: number) =>
    invoke<ReadingBook[]>("reading_list_books", { libraryId }),
  getBook: (bookId: number) => invoke<ReadingBook>("reading_get_book", { bookId }),
  /** Renvoie le chemin du fichier cache d'une page — à convertir avec
      convertFileSrc côté frontend pour obtenir une URL asset. */
  getPage: (bookId: number, pageIndex: number) =>
    invoke<string>("reading_get_page", { bookId, pageIndex }),

  // --- Progression / lecture ---
  getProgress: (bookId: number) =>
    invoke<ReadingProgress | null>("reading_get_progress", { bookId }),
  saveProgress: (
    bookId: number,
    currentPage: number,
    totalPages: number,
    completed: boolean
  ) =>
    invoke<void>("reading_save_progress", {
      bookId,
      currentPage,
      totalPages,
      completed,
    }),

  // --- Rangée « Continuer à lire » ---
  listContinue: (limit: number) =>
    invoke<ContinueReading[]>("reading_list_continue", { limit }),

  // --- Réinitialisation de progression (0.7.2) ---
  /** Retire un livre de « Continuer à lire » et le fait repartir page 1. */
  resetProgress: (bookId: number) =>
    invoke<void>("reading_reset_progress", { bookId }),
  /** Purge toute la rangée « Continuer à lire » pour le profil actif. */
  resetAllProgress: () => invoke<number>("reading_reset_all_progress"),

  // --- Réglages de lecture (par profil) ---
  getSettings: () => invoke<string | null>("reading_get_settings"),
  saveSettings: (settingsJson: string) =>
    invoke<void>("reading_save_settings", { settingsJson }),
};