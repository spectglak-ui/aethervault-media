/**
 * Miroir de `domain::private_video::PrivateVideoFolderSummary` et
 * `db::repositories::private_video_repository::PrivateVideoFileRecord`
 * (Étape 6b-i, doc §6.4 ter).
 */
export interface PrivateVideoFolder {
  id: number;
  private_library_id: number;
  path: string;
  is_available: boolean;
  added_at: string;
}

export interface PrivateVideoFile {
  id: number;
  private_library_id: number;
  folder_id: number;
  path: string;
  file_name: string;
  size_bytes: number;
  modified_at: string;
  is_available: boolean;
  discovered_at: string;
}

/**
 * Miroir de `services::private_video_scanner::PrivateScanSummary`. Scan
 * manuel et synchrone (doc §6.4 ter) : pas d'événements de progression
 * comme le File Scanner public, la commande renvoie directement ce résumé
 * une fois le scan terminé.
 */
export interface PrivateScanSummary {
  private_library_id: number;
  added: number;
  updated: number;
  removed: number;
  unavailable_folders: number;
  /** Fichiers dont le traitement a échoué (n'interrompt plus le reste du
   * scan — correctif de robustesse). */
  failed: number;
}

/**
 * Miroir de `db::repositories::private_video_repository::PrivatePlaybackProgressRecord`.
 */
export interface PrivatePlaybackProgress {
  media_file_id: number;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
}
