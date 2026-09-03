import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import type { PlayerTrack } from "@aethervault/shared-types";

export interface ExtractedMedia {
  kind: "merged" | "split";
  url: string;
  audio_url: string | null;
}

export const playerApi = {
  load: (path: string) => invoke<void>("player_load", { path }),
  loadUrl: (url: string) => invoke<void>("player_load_url", { url }),
  extractMedia: (url: string) => invoke<ExtractedMedia>("player_extract_media", { url }),
  unload: () => invoke<void>("player_unload"),
  setPaused: (paused: boolean) => invoke<void>("player_set_paused", { paused }),
  seek: (seconds: number) => invoke<void>("player_seek", { seconds }),
  setVolume: (volume: number) => invoke<void>("player_set_volume", { volume }),
  setMuted: (muted: boolean) => invoke<void>("player_set_muted", { muted }),
  setRate: (rate: number) => invoke<void>("player_set_rate", { rate }),
  stop: () => invoke<void>("player_stop"),
  redraw: () => invoke<void>("player_redraw"),
  captureScreenshot: () => invoke<string>("player_capture_screenshot"),
  listTracks: () =>
    invoke<{ audio: PlayerTrack[]; subtitles: PlayerTrack[] }>("player_list_tracks"),
  setAudioTrack: (id: number) => invoke<void>("player_set_audio_track", { trackId: id }),
  setSubtitleTrack: (id: number | null) =>
    invoke<void>("player_set_subtitle_track", { trackId: id }),
  getProgress: (mediaFileId: number) =>
    invoke<{ position_seconds: number; duration_seconds: number } | null>(
      "get_playback_progress",
      { mediaFileId }
    ),
  saveProgress: (mediaFileId: number, position: number, duration: number) =>
    invoke<void>("save_playback_progress", { mediaFileId, position, duration }),
  getPrivateProgress: (mediaFileId: number) =>
    invoke<{ position_seconds: number; duration_seconds: number } | null>(
      "get_private_playback_progress",
      { mediaFileId }
    ),
  savePrivateProgress: (mediaFileId: number, position: number, duration: number) =>
    invoke<void>("save_private_playback_progress", { mediaFileId, position, duration }),
  attachSurface: (channel: Channel<ArrayBuffer | number[]>, width: number, height: number) =>
    invoke<void>("player_attach_surface", { channel, width, height }),
  ackFrame: () => invoke<void>("player_ack_frame"),
  pullFrame: () => invoke<ArrayBuffer | number[]>("player_pull_frame"),
  resizeSurface: (width: number, height: number) =>
    invoke<void>("player_resize_surface", { width, height }),
  getPostShader: () => invoke<string>("get_post_shader"),
    setPostShader: (preset: string) => invoke<void>("set_post_shader", { preset }),
};