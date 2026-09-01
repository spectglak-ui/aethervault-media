import { VaultTubePlaylistPicker, type PickableVideo } from "../components/VaultTubePlaylistPicker";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ListVideo, RefreshCw } from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import {
  vaultTubeApi,
  type VaultTubeSubscription,
  type VaultTubeVideo,
} from "../features/vaulttube/api";
import { usePlayer } from "../player/PlayerContext";
import { VaultTubeVideoGrid } from "./VaultTubeVideoGrid";
import "./pages.css";

type SortKey = "recent" | "old" | "alpha";

const selectStyle: CSSProperties = {
  background: "#131318",
  border: "1px solid #2a2a32",
  borderRadius: 8,
  color: "#e8e8ec",
  padding: "8px 10px",
  fontSize: 13,
  outline: "none",
};

/** 0.4.0 — Vidéos d'un abonnement : tri, playlists liées, lecture en un clic. */
export function VaultTubeVideosPage() {
  const [pickerVideo, setPickerVideo] = useState<PickableVideo | null>(null);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const [subscription, setSubscription] = useState<VaultTubeSubscription | null>(null);
  const [videos, setVideos] = useState<VaultTubeVideo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");

  const refresh = useCallback(() => {
    if (!id) return;
    const sid = Number(id);
    void Promise.all([vaultTubeApi.listSubscriptions(), vaultTubeApi.listVideos(sid)]).then(
      ([subs, vids]) => {
        setSubscription(subs.find((s) => s.id === sid) ?? null);
        setVideos(vids);
      }
    );
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sorted = useMemo(() => {
    const arr = [...videos];
    if (sort === "recent") arr.sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0));
    else if (sort === "old") arr.sort((a, b) => (a.published_at ?? 0) - (b.published_at ?? 0));
    else arr.sort((a, b) => a.title.localeCompare(b.title, "fr"));
    return arr;
  }, [videos, sort]);

  const handleRefresh = async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      await vaultTubeApi.refreshSubscription(Number(id));
      refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handlePlay = (clicked: VaultTubeVideo) => {
    const queue = sorted.map((v) => ({
      id: v.id,
      title: v.title,
      path: `https://www.youtube.com/watch?v=${v.youtube_id}`,
      libraryId: -1,
    }));
    const index = sorted.findIndex((v) => v.youtube_id === clicked.youtube_id);
    if (index !== -1) playQueue(queue, index);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Button variant="secondary" onClick={() => navigate("/vaulttube")}>
          <ArrowLeft size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          Abonnements
        </Button>
        {subscription?.thumbnail_url ? (
          <img
            src={subscription.thumbnail_url}
            alt=""
            style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--color-accent, #7c5cff), #4c3a99)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {(subscription?.name ?? "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {subscription?.name ?? "Chargement…"}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>
            {videos.length} vidéo(s)
          </div>
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={selectStyle}
          title="Trier les vidéos"
        >
          <option value="recent">Plus récentes</option>
          <option value="old">Plus anciennes</option>
          <option value="alpha">Titre A → Z</option>
        </select>
        <Button variant="secondary" onClick={() => navigate(`/vaulttube/${id}/playlists`)}>
          <ListVideo size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          Playlists
        </Button>
        <Button variant="secondary" onClick={() => void handleRefresh()} disabled={refreshing}>
          <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          {refreshing ? "Synchro…" : "Actualiser"}
        </Button>
      </div>

      {sorted.length === 0 && !refreshing && (
        <p style={{ color: "var(--color-text-muted, #9a9aa3)", textAlign: "center", padding: 40 }}>
          Aucune vidéo. Cliquez sur Actualiser pour synchroniser.
        </p>
      )}

      <VaultTubeVideoGrid
        videos={sorted}
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
      {pickerVideo && (
        <VaultTubePlaylistPicker video={pickerVideo} onClose={() => setPickerVideo(null)} />
      )}
    </div>
  );
}