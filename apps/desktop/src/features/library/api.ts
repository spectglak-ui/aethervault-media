import { invoke } from "@tauri-apps/api/core";
import type { Library, LibraryFolder, MediaFile } from "@aethervault/shared-types";

/**
 * Point d'accès unique aux commandes backend liées aux bibliothèques.
 * Les pages n'appellent jamais `invoke` directement : elles passent par ici,
 * pour n'avoir qu'un seul endroit à modifier si un nom de commande change.
 */
export const libraryApi = {
  list: () => invoke<Library[]>("list_libraries"),

  create: (input: {
    name: string;
    categoryId: number;
    icon?: string;
    accentColor?: string;
  }) =>
    invoke<number>("create_library", {
      name: input.name,
      categoryId: input.categoryId,
      icon: input.icon ?? null,
      accentColor: input.accentColor ?? null,
    }),

  remove: (libraryId: number) => invoke<void>("delete_library", { libraryId }),

  listFolders: (libraryId: number) =>
    invoke<LibraryFolder[]>("list_library_folders", { libraryId }),

  pickFolder: () => invoke<string | null>("pick_folder"),

  addFolder: (libraryId: number, path: string) =>
    invoke<number>("add_library_folder", { libraryId, path }),

  removeFolder: (folderId: number) => invoke<void>("remove_library_folder", { folderId }),

  listMediaFiles: (libraryId: number) =>
    invoke<MediaFile[]>("list_media_files", { libraryId }),

  getMediaFile: (mediaFileId: number) => invoke<MediaFile>("get_media_file", { mediaFileId }),

  scan: (libraryId: number) => invoke<void>("scan_library", { libraryId }),

  /** Relance l'appariement de métadonnées sans repasser par un scan complet
   * (Étape 4) — voir `commands::library::match_library_metadata_command`. */
  matchMetadata: (libraryId: number) =>
    invoke<void>("match_library_metadata_command", { libraryId }),
};
