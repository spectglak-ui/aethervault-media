import { invoke } from "@tauri-apps/api/core";
import type { PrivateImageFile, PrivateImageFolder, PrivateImageScanSummary } from "@aethervault/shared-types";

/**
 * Point d'accès unique aux commandes backend des images privées (Étape
 * 6b-ii, doc §6.4 quater). Les pages n'appellent jamais `invoke`
 * directement.
 *
 * Le sélecteur de dossier natif est celui déjà utilisé par les
 * bibliothèques publiques et les vidéos privées (`libraryApi.pickFolder`,
 * commande `pick_folder`) — pas de doublon ici.
 */
export const privateImageApi = {
  listFolders: (privateLibraryId: number) =>
    invoke<PrivateImageFolder[]>("list_private_image_folders", { privateLibraryId }),

  /** Ajoute le dossier puis lance immédiatement un scan de la
   * bibliothèque — voir `domain::private_image::add_folder`. */
  addFolder: (privateLibraryId: number, path: string) =>
    invoke<PrivateImageScanSummary>("add_private_image_folder", { privateLibraryId, path }),

  removeFolder: (folderId: number) => invoke<void>("remove_private_image_folder", { folderId }),

  /** Scan manuel (doc §6.4 ter/quater) — synchrone. */
  scan: (privateLibraryId: number) =>
    invoke<PrivateImageScanSummary>("scan_private_image_library", { privateLibraryId }),

  listFiles: (folderId: number) => invoke<PrivateImageFile[]>("list_private_image_files", { folderId }),

  /** Vignette encodée en base64, ou `null` si absente. Le composant
   * `PrivateThumbnailImage` construit directement une URI `data:` à
   * partir de cette chaîne — pas de `Blob`/URL objet à gérer. */
  getThumbnail: (fileId: number) => invoke<string | null>("get_private_image_thumbnail", { fileId }),

  getAlbumCover: (folderId: number) => invoke<string | null>("get_private_album_cover", { folderId }),

  /** `fileId: null` réinitialise à la couverture par défaut (première
   * photo de l'album). */
  setAlbumCover: (folderId: number, fileId: number | null) =>
    invoke<void>("set_private_album_cover", { folderId, fileId }),
};
