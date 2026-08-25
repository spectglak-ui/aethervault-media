import { invoke } from "@tauri-apps/api/core";
import type { PrivateScanSummary, PrivateVideoFile, PrivateVideoFolder } from "@aethervault/shared-types";

/**
 * Point d'accès unique aux commandes backend des vidéos privées (Étape
 * 6b-i, doc §6.4 ter). Les pages n'appellent jamais `invoke` directement.
 *
 * Le sélecteur de dossier natif est celui déjà utilisé par les
 * bibliothèques publiques (`libraryApi.pickFolder`, commande
 * `pick_folder`) — aucune connaissance de l'entité appelante côté Rust,
 * pas besoin d'un doublon ici.
 */
export const privateVideoApi = {
  listFolders: (privateLibraryId: number) =>
    invoke<PrivateVideoFolder[]>("list_private_video_folders", { privateLibraryId }),

  /** Ajoute le dossier puis lance immédiatement un scan de la
   * bibliothèque — voir `domain::private_video::add_folder`. */
  addFolder: (privateLibraryId: number, path: string) =>
    invoke<PrivateScanSummary>("add_private_video_folder", { privateLibraryId, path }),

  removeFolder: (folderId: number) => invoke<void>("remove_private_video_folder", { folderId }),

  listFiles: (privateLibraryId: number) =>
    invoke<PrivateVideoFile[]>("list_private_video_files", { privateLibraryId }),

  /** Scan manuel (doc §6.4 ter) — synchrone, pas d'événements de
   * progression comme le File Scanner public. */
  scan: (privateLibraryId: number) =>
    invoke<PrivateScanSummary>("scan_private_video_library", { privateLibraryId }),
};
