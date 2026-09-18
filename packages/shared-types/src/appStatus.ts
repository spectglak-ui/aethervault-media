/**
 * Statut renvoyé par la commande backend `get_app_status`.
 * Miroir du struct Rust `commands::status::AppStatus` — les noms de champs
 * doivent rester synchronisés manuellement (pas de génération automatique
 * à ce stade).
 */
export interface AppStatus {
  app_name: string;
  version: string;
  database_path: string;
  log_directory: string;
  profile_count: number;
}
