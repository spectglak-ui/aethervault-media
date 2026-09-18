/** Formate un nombre de secondes en `m:ss` (ou `h:mm:ss` au-delà d'une
 * heure). Partagé entre `PlayerDock` et `DetachedPlayerWindow` — les deux
 * affichent la même barre de progression, juste dans des fenêtres
 * différentes. */
export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
