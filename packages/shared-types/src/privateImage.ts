/**
 * Miroir de `db::repositories::private_image_repository::PrivateImageFolderRecord`
 * et `PrivateImageFileRecord` (Étape 6b-ii, doc §6.4 quater).
 */
export interface PrivateImageFolder {
  id: number;
  private_library_id: number;
  path: string;
  cover_file_id: number | null;
  added_at: string;
}

/**
 * Sans la vignette elle-même (`has_thumbnail` indique seulement si l'on
 * peut en demander une) — voir `privateImageApi.getThumbnail`, une
 * commande séparée par conception (doc §6.4 quater).
 */
export interface PrivateImageFile {
  id: number;
  private_library_id: number;
  folder_id: number;
  path: string;
  file_name: string;
  size_bytes: number;
  modified_at: string;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  camera_model: string | null;
  has_thumbnail: boolean;
  is_available: boolean;
  discovered_at: string;
}

/**
 * Miroir de `services::private_image_scanner::PrivateImageScanSummary`.
 * Scan manuel et synchrone (doc §6.4 quater).
 */
export interface PrivateImageScanSummary {
  private_library_id: number;
  added: number;
  updated: number;
  removed: number;
  unavailable_folders: number;
  /** Fichiers dont le traitement a échoué (n'interrompt plus le reste du
   * scan — correctif de robustesse). */
  failed: number;
}
