import { invoke } from "@tauri-apps/api/core";
import type { PlaybackProgress, PlayerTrackList } from "@aethervault/shared-types";

/**
 * Passe-plat vers les commandes Tauri du Playback Engine Bridge
 * (`services::playback_engine` côté Rust). Volontairement sans logique :
 * toute décision (formats supportés, conversion d'unités mpv, etc.) vit
 * côté Rust, la seule couche qui connaît réellement le moteur — voir la
 * documentation technique §4.2.
 */
export const playerApi = {
  getProgress: (mediaFileId: number) =>
    invoke<PlaybackProgress | null>("get_playback_progress", { mediaFileId }),
  saveProgress: (mediaFileId: number, positionSeconds: number, durationSeconds: number) =>
    invoke<void>("save_playback_progress", {
      mediaFileId,
      positionSeconds,
      durationSeconds,
    }),
  getPrivateProgress: (mediaFileId: number) =>
    invoke<PlaybackProgress | null>("get_private_playback_progress", { mediaFileId }),
  savePrivateProgress: (mediaFileId: number, positionSeconds: number, durationSeconds: number) =>
    invoke<void>("save_private_playback_progress", {
      mediaFileId,
      positionSeconds,
      durationSeconds,
    }),
  load: (path: string) => invoke<void>("player_load", { path }),
  setPaused: (paused: boolean) => invoke<void>("player_set_paused", { paused }),
  seek: (seconds: number) => invoke<void>("player_seek", { seconds }),
  setVolume: (volume: number) => invoke<void>("player_set_volume", { volume }),
  setMuted: (muted: boolean) => invoke<void>("player_set_muted", { muted }),
  setRate: (rate: number) => invoke<void>("player_set_rate", { rate }),
  stop: () => invoke<void>("player_stop", {}),
  attachSurface: (channel: Channel<ArrayBuffer | number[]>, width: number, height: number) =>
    invoke<void>("player_attach_surface", { channel, width, height }),
  resizeSurface: (width: number, height: number) =>
    invoke<void>("player_resize_surface", { width, height }),
  ackFrame: () => invoke<void>("player_ack_frame", {}),
  pullFrame: () => invoke<ArrayBuffer | number[]>("player_pull_frame", {}),
  redraw: () => invoke<void>("player_redraw", {}),
  captureScreenshot: () => invoke<string>("player_capture_screenshot", {}),
  listTracks: () => invoke<PlayerTrackList>("player_list_tracks", {}),
  setAudioTrack: (trackId: number) => invoke<void>("player_set_audio_track", { trackId }),
  setSubtitleTrack: (trackId: number | null) =>
    invoke<void>("player_set_subtitle_track", { trackId }),
};

/** API des commandes liées aux fenêtres (PiP, mode flottant). */
export const windowApi = {
  openPlayerWindow: () => invoke<void>("open_player_window", {}),
  markPlayerReady: () => invoke<void>("mark_player_ready", {}),
  closePlayerWindow: () => invoke<void>("close_player_window", {}),
  toggleFloatingPlayer: () => invoke<void>("toggle_floating_player", {}),
};