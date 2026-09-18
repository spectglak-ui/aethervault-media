import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ListVideo, RefreshCw } from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import {
  vaultTubeApi,
  type VaultTubePlaylist,
  type VaultTubeSubscription,
} from "../features/vaulttube/api";
import "./pages.css";

/** 0.4.0 — Playlists publiques d'une chaîne suivie. Cliquer une playlist
 * ouvre l'aperçu de ses vidéos (lecture immédiate + option « Suivre »). */
export function VaultTubePlaylistsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [subscription, setSubscription] = useState<VaultTubeSubscription | null>(null);
  const [playlists, setPlaylists] = useState<VaultTubePlaylist[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const sid = Number(id);
    setLoading(true);
    try {
      const subs = await vaultTubeApi.listSubscriptions();
      setSubscription(subs.find((s) => s.id === sid) ?? null);
      let pls = await vaultTubeApi.listPlaylists(sid);
      if (pls.length === 0) {
        await vaultTubeApi.syncPlaylists(sid).catch(() => 0);
        pls = await vaultTubeApi.listPlaylists(sid);
      }
      setPlaylists(pls);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Button variant="secondary" onClick={() => navigate(`/vaulttube/${id}`)}>
          <ArrowLeft size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          Vidéos
        </Button>
        <div style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>
          Playlists — {subscription?.name ?? "…"}
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          Actualiser
        </Button>
      </div>

      {loading && (
        <p style={{ color: "var(--color-text-muted, #9a9aa3)", textAlign: "center", padding: 40 }}>
          Synchronisation des playlists…
        </p>
      )}

      {!loading && playlists.length === 0 && (
        <p style={{ color: "var(--color-text-muted, #9a9aa3)", textAlign: "center", padding: 40 }}>
          Aucune playlist publique trouvée pour cette chaîne.
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
          gap: 18,
        }}
      >
        {playlists.map((pl) => (
          <div
            key={pl.id}
            onClick={() => navigate(`/vaulttube/playlist/${pl.youtube_id}`)}
            style={{
              cursor: "pointer",
              background: "var(--color-surface, #1e1e24)",
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,.06)",
              transition: "transform .15s ease, border-color .15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-3px)";
              e.currentTarget.style.borderColor = "var(--color-accent, #7c5cff)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.borderColor = "rgba(255,255,255,.06)";
            }}
          >
            <div style={{ position: "relative", aspectRatio: "16/9", background: "#000" }}>
              {pl.thumbnail_url ? (
                <img
                  src={pl.thumbnail_url}
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg, #241b4d, #12101c)",
                  }}
                >
                  <ListVideo size={40} style={{ opacity: 0.5 }} />
                </div>
              )}
              {pl.video_count !== null && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 6,
                    right: 6,
                    background: "rgba(0,0,0,.85)",
                    color: "#fff",
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                >
                  {pl.video_count} vidéo(s)
                </span>
              )}
            </div>
            <div style={{ padding: "10px 12px 12px", fontSize: 13, fontWeight: 600 }}>{pl.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}