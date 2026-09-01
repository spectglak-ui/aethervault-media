import { useEffect, useState } from "react";
import { vaultTubeApi, type UserPlaylist } from "../features/vaulttube/api";

export interface PickableVideo {
  youtube_id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  channel: string | null;
}

/** Mini-modale « Ajouter à une playlist » (locale), avec création directe. */
export function VaultTubePlaylistPicker({
  video,
  onClose,
}: {
  video: PickableVideo;
  onClose: () => void;
}) {
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    vaultTubeApi.listUserPlaylists().then(setPlaylists).catch(() => setPlaylists([]));
  }, []);

  const add = async (playlistId: number) => {
    setBusy(true);
    try {
      await vaultTubeApi.addToUserPlaylist({
        playlistId,
        youtubeId: video.youtube_id,
        title: video.title,
        thumbnailUrl: video.thumbnail_url,
        durationSeconds: video.duration_seconds,
        channel: video.channel,
      });
      setFeedback("Ajouté ✔");
      setTimeout(onClose, 350);
    } catch (e) {
      setFeedback(String(e));
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const pid = await vaultTubeApi.createUserPlaylist(name);
      await add(pid);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#1b1b21",
          border: "1px solid rgba(255,255,255,.12)",
          borderRadius: 12,
          padding: 18,
          width: 340,
          maxHeight: "70vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Ajouter à une playlist</div>
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-muted, #9a9aa3)",
            marginBottom: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {video.title}
        </div>
        {feedback && (
          <div style={{ fontSize: 12, color: "#8ee6a1", marginBottom: 8 }}>{feedback}</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {playlists.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>
              Aucune playlist locale — créez-en une ci-dessous.
            </div>
          )}
          {playlists.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => void add(p.id)}
              style={{
                textAlign: "left",
                background: "#232329",
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 8,
                color: "#e8e8ec",
                padding: "8px 10px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {p.name}{" "}
              <span style={{ color: "var(--color-text-muted, #9a9aa3)", fontSize: 11 }}>
                ({p.item_count} vidéo(s))
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createAndAdd()}
            placeholder="Nouvelle playlist…"
            style={{
              flex: 1,
              background: "#131318",
              border: "1px solid #2a2a32",
              borderRadius: 8,
              color: "#e8e8ec",
              padding: "7px 10px",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            disabled={busy || !newName.trim()}
            onClick={() => void createAndAdd()}
            style={{
              background: "var(--color-accent, #7c5cff)",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              padding: "7px 12px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  );
}