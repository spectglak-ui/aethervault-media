import { ListPlus, Play } from "lucide-react";
import { videoThumb, type VaultTubeVideo } from "../features/vaulttube/api";

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VaultTubeVideoGrid({
  videos,
  onPlay,
  onAddToPlaylist,
}: {
  videos: VaultTubeVideo[];
  onPlay: (video: VaultTubeVideo) => void;
  onAddToPlaylist?: (video: VaultTubeVideo) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
        gap: 18,
      }}
    >
      {videos.map((video, i) => (
        <div
          key={`${video.youtube_id}-${i}`}
          className="avm-vt-card"
          onClick={() => onPlay(video)}
          style={{
            cursor: "pointer",
            background: "var(--color-surface, #1e1e24)",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.06)",
            transition: "transform .15s ease, border-color .15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-3px)";
            e.currentTarget.style.borderColor = "var(--color-accent, #7c5cff)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
          }}
        >
          <div style={{ position: "relative", aspectRatio: "16/9", background: "#000" }}>
            <img
              src={videoThumb(video)}
              alt=""
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            {formatDuration(video.duration_seconds) && (
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
                  fontFamily: "monospace",
                }}
              >
                {formatDuration(video.duration_seconds)}
              </span>
            )}
            {onAddToPlaylist && (
              <button
                className="avm-vt-card__add"
                title="Ajouter à une playlist"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToPlaylist(video);
                }}
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  background: "rgba(0,0,0,.75)",
                  border: "none",
                  borderRadius: 6,
                  color: "#fff",
                  padding: 5,
                  cursor: "pointer",
                  opacity: 0,
                  transition: "opacity .15s ease",
                  zIndex: 2,
                }}
              >
                <ListPlus size={16} />
              </button>
            )}
            <span
              className="avm-vt-card__overlay"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,.45)",
                opacity: 0,
                transition: "opacity .15s ease",
              }}
            >
              <Play size={38} fill="#fff" color="#fff" />
            </span>
          </div>
          <div style={{ padding: "10px 12px 12px" }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.35,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                minHeight: "2.7em",
              }}
            >
              {video.title}
            </div>
            {video.published_at !== null && (
              <div style={{ fontSize: 11, color: "var(--color-text-muted, #9a9aa3)", marginTop: 5 }}>
                {new Date(video.published_at * 1000).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}