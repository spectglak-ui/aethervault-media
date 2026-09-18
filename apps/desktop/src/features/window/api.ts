import { invoke } from "@tauri-apps/api/core";

/** Passe-plat vers `commands::window`. */
export const windowApi = {
  // ⚠️ PiP en quarantaine : ces commandes restent disponibles côté Rust
  // mais ne sont plus appelées par l'interface (bouton masqué).
  openPlayerWindow: () => invoke<void>("open_player_window", {}),
  markPlayerReady: () => invoke<void>("mark_player_ready", {}),
  closePlayerWindow: () => invoke<void>("close_player_window", {}),
  toggleFloatingPlayer: () => invoke<void>("toggle_floating_player", {}),
};