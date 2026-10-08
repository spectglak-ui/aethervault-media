import type { VaultTubeVideo } from "../vaulttube/api";

export function isShortByMeta(video: VaultTubeVideo): boolean {
  if (
    typeof video.duration_seconds === "number" &&
    video.duration_seconds > 0 &&
    video.duration_seconds <= 60
  ) {
    return true;
  }

  const text = [
    video.title,
    video.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return text.includes("#shorts");
}
