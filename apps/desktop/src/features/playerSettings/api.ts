import { invoke } from "@tauri-apps/api/core";
import type { PlayerSettingsChangedPayload } from "@aethervault/shared-types";

/**
 * Passe-plat vers `commands::player_settings` (Rust) — persistance de
 * volume/muet/vitesse entre les sessions.
 *
 * ⚠️ Délibérément séparé de `playerApi` (`features/player/api.ts`, le
 * pont vers le moteur mpv) : ces deux commandes ne font que lire/écrire
 * une ligne SQLite, aucun lien avec `PlaybackEngineHandle`, le pipeline
 * vidéo ou les threads de rendu.
 */
export const playerSettingsApi = {
  /** `null` si aucun réglage n'a encore été enregistré (premier lancement). */
  get: () => invoke<PlayerSettingsChangedPayload | null>("get_player_settings", {}),

  save: (settings: PlayerSettingsChangedPayload) =>
    invoke<void>("save_player_settings", settings),
};
