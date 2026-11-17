import { useCallback, useState } from "react";
import { usePlayer } from "../../player/PlayerContext";
import { watchUrl } from "../vaulttube/api";
import { errorMessage, musicApi, type MusicTrack } from "./api";

/**
 * Lance un titre du catalogue dans le lecteur audio : retrouve la bonne vidéo
 * YouTube (version audio officielle, durée cohérente — le choix est mémorisé pour
 * la fois suivante) puis l'envoie à la file de lecture.
 */
export function usePlayTrack() {
  const { playQueue } = usePlayer();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const play = useCallback(
    async (track: MusicTrack) => {
      if (busyId) return;
      setBusyId(track.id);
      setError(null);
      try {
        const resolution = await musicApi.resolveTrack(track);
        playQueue(
          [
            {
              id: 0,
              title: `${track.title} — ${track.artist}`,
              path: watchUrl("youtube", resolution.video_id),
              libraryId: -1,
              mode: "audio",
            },
          ],
          0
        );
      } catch (e) {
        setError(errorMessage(e, "Impossible de trouver une version à lire pour ce titre."));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, playQueue]
  );

  return { play, busyId, error, clearError: () => setError(null) };
}
