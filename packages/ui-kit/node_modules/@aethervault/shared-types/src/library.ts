/**
 * Miroirs des structures Rust exposées par `commands::library`.
 */

export interface Library {
  id: number;
  name: string;
  /** Catégorie de rattachement (doc §6.1) — remplace l'ancien `media_type`
   * texte libre depuis l'Étape 4. `null` uniquement pour une bibliothèque
   * créée avant l'Étape 4 et pas encore basculée par
   * `db::seed::backfill_library_categories` (ne devrait jamais arriver au
   * démarrage suivant : la bascule est automatique). */
  category_id: number | null;
  icon: string | null;
  accent_color: string | null;
  sort_order: number;
  folder_count: number;
  media_count: number;
  unavailable_folder_count: number;
  created_at: string;
  updated_at: string;
}

export interface LibraryFolder {
  id: number;
  library_id: number;
  path: string;
  is_available: boolean;
  added_at: string;
}

export interface MediaFile {
  id: number;
  library_id: number;
  folder_id: number;
  path: string;
  file_name: string;
  size_bytes: number;
  modified_at: string;
  is_available: boolean;
  discovered_at: string;
  /** Rattachement au modèle de contenu (doc §6.3) — voir `content.ts`.
   * Exclusif, jamais les deux à la fois ; les deux restent `null` tant que
   * le Metadata Service n'a pas traité ce fichier. */
  title_id: number | null;
  episode_id: number | null;
}

/** Payload de l'événement `library:scan-complete`. */
export interface ScanCompleteEvent {
  library_id: number;
  added: number;
  updated: number;
  removed: number;
  unavailable_folders: number;
}

/** Payload de l'événement `library:metadata-matched` (Étape 4). Diffusé
 * après chaque `library:scan-complete` réussi, et par
 * `match_library_metadata_command` en dehors d'un scan. */
export interface MetadataMatchedEvent {
  library_id: number;
  matched: number;
  skipped: number;
}
