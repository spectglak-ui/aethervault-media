import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Play, Trash2 } from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import { vaultTubeApi, type UserPlaylist, type UserPlaylistItem } from "../features/vaulttube/api";
import { usePlayer } from "../player/PlayerContext";
import { formatDuration } from "./VaultTubeVideoGrid";
import "./pages.css";

const rowBtn: CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--color-text-muted, #9a9aa3)",
  padding: 6,
  borderRadius: 6,
  display: "inline-flex",
};

/** 0.4.0 — Playlist locale : lecture dans l'ordre choisi, réordonnement
 * ▲▼, retrait de vidéos, suppression de la playlist. */
export function VaultTubeUserPlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const [playlist, setPlaylist] = useState<UserPlaylist | null>(null);
  const [items, setItems] = useState<UserPlaylistItem[]>([]);

  const refresh = useCallback(() => {
    if (!id) return;
    const pid = Number(id);
    void Promise.all([
      vaultTubeApi.listUserPlaylists(),
      vaultTubeApi.listUserPlaylistItems(pid),
    ]).then(([pls, its]) => {
      setPlaylist(pls.find((p) => p.id === pid) ?? null);
      setItems(its);
    });
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePlayFrom = (index: number) => {
    const queue = items.map((it) => ({
      id: it.id,
      title: it.title,
      path: `https://www.youtube.com/watch?v=${it.youtube_id}`,
      libraryId: -1,
    }));
    playQueue(queue, index);
  };

  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    await vaultTubeApi.reorderUserPlaylist(Number(id), reordered.map((it) => it.id));
    setItems(reordered);
  };

  const handleRemove = async (it: UserPlaylistItem) => {
    await vaultTubeApi.removeFromUserPlaylist(Number(id), it.youtube_id);
    refresh();
  };

  const handleDeletePlaylist = async () => {
    if (!window.confirm(`Supprimer la playlist « ${playlist?.name ?? ""} » ?`)) return;
    await vaultTubeApi.deleteUserPlaylist(Number(id));
    navigate("/vaulttube");
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Button variant="secondary" onClick={() => navigate("/vaulttube")}>
          <ArrowLeft size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          VaultTube
        </Button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{playlist?.name ?? "…"}</div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>
            {items.length} vidéo(s) — playlist locale
          </div>
        </div>
        <Button onClick={() => handlePlayFrom(0)} disabled={items.length === 0}>
          <Play size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          Tout lire
        </Button>
        <Button variant="secondary" onClick={() => void handleDeletePlaylist()}>
          <Trash2 size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          Supprimer
        </Button>
      </div>

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted, #9a9aa3)", textAlign: "center", padding: 40 }}>
          Playlist vide — ajoutez des vidéos depuis la recherche ou les grilles (icône ＋).
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it, index) => (
          <div
            key={it.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 12px",
              background: "var(--color-surface, #1e1e24)",
              border: "1px solid rgba(255,255,255,.06)",
              borderRadius: 10,
            }}
          >
            <span style={{ width: 22, textAlign: "center", color: "var(--color-text-muted, #9a9aa3)", fontSize: 12 }}>
              {index + 1}
            </span>
            <img
              src={it.thumbnail_url ?? `https://i.ytimg.com/vi/${it.youtube_id}/hqdefault.jpg`}
              alt=""
              style={{ width: 72, height: 44, objectFit: "cover", borderRadius: 6, background: "#000", flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => handlePlayFrom(index)}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {it.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted, #9a9aa3)", marginTop: 2 }}>
                {it.channel ?? ""}
                {it.channel && it.duration_seconds !== null ? " · " : ""}
                {formatDuration(it.duration_seconds)}
              </div>
            </div>
            <button title="Lire à partir d'ici" style={rowBtn} onClick={() => handlePlayFrom(index)}>
              <Play size={15} />
            </button>
            <button title="Monter" style={rowBtn} disabled={index === 0} onClick={() => void handleMove(index, -1)}>
              <ArrowUp size={15} />
            </button>
            <button title="Descendre" style={rowBtn} disabled={index === items.length - 1} onClick={() => void handleMove(index, 1)}>
              <ArrowDown size={15} />
            </button>
            <button title="Retirer de la playlist" style={rowBtn} onClick={() => void handleRemove(it)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}