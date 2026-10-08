import type { PlayableMedia } from "@aethervault/shared-types";
import type { VaultTubeVideo } from "../vaulttube/api";

/** 0.7.2 â€” URL Â« watch Â» canonique d'une vidÃ©o en ligne : mÃªme contrat
    que `watchUrl` de VaultTubeVideosPage â€” c'est ce que le moteur Rust
    rÃ©sout via yt-dlp au chargement. */
export function watchUrl(source: string, videoId: string): string {
  if (source === "dailymotion") {
    return `https://www.dailymotion.com/video/${videoId}`;
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Mapping PlayableMedia IDENTIQUE Ã  `handlePlay` de VaultTubeVideosPage
    (id de repli, libraryId -1, `mode` conservÃ© pour le moteur Rust). */
export function toAetherFyPlayable(video: VaultTubeVideo, index: number): PlayableMedia {
  return {
    id: video.id || index + 1,
    title: video.title,
    path: watchUrl(video.source, video.youtube_id),
    libraryId: -1,
    mode: video.mode,
  };
}
