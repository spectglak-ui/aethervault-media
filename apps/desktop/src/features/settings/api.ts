import { invoke } from "@tauri-apps/api/core";
import type { MetadataSettings } from "@aethervault/shared-types";

/** Paramètres applicatifs (Étape 7) — section « Métadonnées en ligne ». */
export const metadataApi = {
  getSettings: () => invoke<MetadataSettings>("get_metadata_settings"),
  saveSettings: (settings: MetadataSettings) =>
    invoke<void>("save_metadata_settings", { settings }),
};