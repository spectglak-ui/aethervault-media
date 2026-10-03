import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ListPlus, ListVideo, RefreshCw } from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import {
  vaultTubeApi,
  videoThumb,
  watchUrl,
  type VaultTubeSubscription,
  type VaultTubeVideo,
} from "../features/vaulttube/api";
import { usePlayer } from "../player/PlayerContext";
import { VaultTubeVideoGrid } from "./VaultTubeVideoGrid";
import { VaultTubeTrackList } from "./VaultTubeTrackList";
import { VaultTubePlaylistPicker, type PickableVideo } from "../components/VaultTubePlaylistPicker";
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

/** 0.4.0 — Vidéos d'un abonnement : tri, playlists liées, lecture en un
 * clic. Phase 3 : chaque élément de la file porte `mode` → la vue
 * immersive (audio Spotify / vidéo YouTube) s'ouvre automatiquement. */
export function VaultTubeVideosPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const [pickerVideo, setPickerVideo] = useState<PickableVideo | null>(null);
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
    const queue = sorted.map((v, i) => ({
      id: v.id || i + 1,
      title: v.title,
      path: watchUrl(v.source, v.youtube_id),
      libraryId: -1,
      mode: v.mode,
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
          <div
            style={{
              fontSize: 12,
              color: subscription?.mode === "audio" ? "#1db954" : "var(--color-text-muted, #9a9aa3)",
            }}
          >
            {videos.length} {subscription?.mode === "audio" ? "titre(s)" : "vidéo(s)"}
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

      {/* FONCTIONNALITÉ (refonte UI AetherFy, Phase 2) : une chaîne ou
          playlist suivie en mode musique s'affiche en liste dense façon
          Spotify plutôt qu'en grille de vignettes 16:9 — auparavant les
          DEUX modes partageaient la même grille, même en mode musique.
          Le mode vidéo garde `VaultTubeVideoGrid`, inchangée. */}
      {subscription?.mode === "audio" ? (
        <VaultTubeTrackList
          items={sorted.map((v, i) => ({
            key: `${v.youtube_id}-${i}`,
            title: v.title,
            subtitle: subscription?.name ?? null,
            thumbnailUrl: videoThumb(v),
            durationSeconds: v.duration_seconds,
          }))}
          onPlay={(index) => handlePlay(sorted[index])}
          renderActions={(index) => (
            <button
              title="Ajouter à une playlist"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted, #9a9aa3)", padding: 6, display: "inline-flex" }}
              onClick={() =>
                setPickerVideo({
                  youtube_id: sorted[index].youtube_id,
                  title: sorted[index].title,
                  thumbnail_url: sorted[index].thumbnail_url,
                  duration_seconds: sorted[index].duration_seconds,
                  channel: null,
                  source: sorted[index].source,
                })
              }
            >
              <ListPlus size={15} />
            </button>
          )}
        />
      ) : (
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
              source: v.source,
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