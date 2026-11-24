import { invoke } from "@tauri-apps/api/core";
import type { MetadataSettings } from "@aethervault/shared-types";

/** Paramètres applicatifs (Étape 7) — section « Métadonnées en ligne ». */
/** Scan automatique des bibliothèques Films / Séries / Anime / Documentaires (activé par défaut). */
export const autoScanApi = {
  isEnabled: () => invoke<boolean>("get_auto_scan_enabled"),
  setEnabled: (enabled: boolean) => invoke<void>("set_auto_scan_enabled", { enabled }),
};

export const metadataApi = {
  getSettings: () => invoke<MetadataSettings>("get_metadata_settings"),
  saveSettings: (settings: MetadataSettings) =>
    invoke<void>("save_metadata_settings", { settings }),
};