import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import { vaultTubeApi, type VaultTubeVideo } from "../features/vaulttube/api";
import { usePlayer } from "../player/PlayerContext";
import { VaultTubeVideoGrid } from "./VaultTubeVideoGrid";
import { VaultTubePlaylistPicker, type PickableVideo } from "../components/VaultTubePlaylistPicker";
import "./pages.css";

/** 0.4.0 — Aperçu d'une playlist NON suivie : vidéos chargées en direct
 * via yt-dlp, lecture immédiate, et « Suivre » pour l'ajouter. */
export function VaultTubePlaylistPreviewPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const [videos, setVideos] = useState<VaultTubeVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [pickerVideo, setPickerVideo] = useState<PickableVideo | null>(null);
  const url = `https://www.youtube.com/playlist?list=${playlistId ?? ""}`;

  useEffect(() => {
    setVideos(null);
    setError(null);
    vaultTubeApi
      .previewVideos(url)
      .then(setVideos)
      .catch((e) => {
        setError(String(e));
        setVideos([]);
      });
  }, [url]);

  const handleFollow = async () => {
    setFollowing(true);
    try {
      await vaultTubeApi.addSubscription(url);
      navigate("/vaulttube");
    } catch (e) {
      setError(String(e));
      setFollowing(false);
    }
  };

  const handlePlay = (clicked: VaultTubeVideo) => {
    const list = videos ?? [];
    const queue = list.map((v, i) => ({
      id: i + 1,
      title: v.title,
      path: `https://www.youtube.com/watch?v=${v.youtube_id}`,
      libraryId: -1,
    }));
    const index = list.findIndex((v) => v.youtube_id === clicked.youtube_id);
    if (index !== -1) playQueue(queue, index);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          Retour
        </Button>
        <div style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>
          {videos === null ? "Chargement de la playlist…" : `Playlist (${videos.length} vidéos)`}
        </div>
        <Button onClick={() => void handleFollow()} disabled={following}>
          <Plus size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          {following ? "Ajout…" : "Suivre cette playlist"}
        </Button>
      </div>

      {error && (
        <div
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            background: "rgba(239,68,68,.12)",
            color: "#fca5a5",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {videos !== null && videos.length === 0 && !error && (
        <p style={{ color: "var(--color-text-muted, #9a9aa3)", textAlign: "center", padding: 40 }}>
          Aucune vidéo dans cette playlist.
        </p>
      )}

      {videos !== null && (
        <VaultTubeVideoGrid
          videos={videos}
          onPlay={handlePlay}
          onAddToPlaylist={(v) =>
            setPickerVideo({
              youtube_id: v.youtube_id,
              title: v.title,
              thumbnail_url: v.thumbnail_url,
              duration_seconds: v.duration_seconds,
              channel: null,
            })
          }
        />
      )}
      {pickerVideo && (
        <VaultTubePlaylistPicker video={pickerVideo} onClose={() => setPickerVideo(null)} />
      )}
    </div>
  );
}