/** Réglages du fournisseur en ligne TMDB (Étape 7) — miroir de
 * `services::metadata::tmdb::MetadataSettings`. */
export interface MetadataSettings {
  api_key: string;
  language: string;
  auto_enrich: boolean;
}