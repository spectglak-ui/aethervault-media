import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ShareOffer {
  code: string;
  port: number;
  fileName: string;
  size: number;
}
export interface ShareProgress {
  phase: "send" | "recv";
  transferred: number;
  total: number;
}

/** Partage de média par code (Étape 8) — P2P direct chiffré, aucun cloud. */
export const shareApi = {
  start: (mediaFileId: number, lanOnly: boolean) =>
    invoke<ShareOffer>("share_start", { mediaFileId, lanOnly }),
  stop: () => invoke<void>("share_stop"),
  receive: (code: string) => invoke<string>("share_receive", { code }),
  onProgress: (callback: (progress: ShareProgress) => void) =>
    listen<ShareProgress>("share-progress", (event) => callback(event.payload)),
};