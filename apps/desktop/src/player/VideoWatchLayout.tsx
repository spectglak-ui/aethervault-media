import { X } from "lucide-react";
import { usePlayer } from "./PlayerContext";
import { PlayerSurface } from "./PlayerSurface";
import { PlayerControls } from "./PlayerControls";
import { formatDuration } from "./formatTime";

/**
 * 0.4.0 — Disposition VIDÉO façon YouTube (jalon 3) : lecteur 16:9 à
 * gauche, liste « À suivre » (file d'attente) à droite. S'affiche quand
 * la piste en cours est en mode "video" lancée depuis AetherFy.
 */
export function VideoWatchLayout() {
  const { queue, currentMedia, playQueue, closeAudioView } = usePlayer();

  if (!currentMedia) return null;

  const upNext = queue.items.filter((_, i) => i !== queue.currentIndex);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "var(--color-bg, #131318)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 24,
          maxWidth: 1400,
          margin: "0 auto",
          padding: "20px 24px 40px",
          alignItems: "flex-start",
        }}
      >
        {/* ----- Colonne lecteur ----- */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="avm-player avm-player--inline"
            style={{
              position: "relative",
              aspectRatio: "16/9",
              borderRadius: 12,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <PlayerSurface className="avm-player__surface" />
            <div className="avm-player__controls-wrap">
              <PlayerControls variant="normal" />
            </div>
          </div>

          <h1 style={{ fontSize: 20, fontWeight: 800, margin: "16px 0 6px" }}>
            {currentMedia.title}
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "var(--color-text-muted, #9a9aa3)",
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600, color: "#e8e8ec" }}>
              {currentMedia.channel ?? "AetherFy"}
            </span>
            <button
              onClick={closeAudioView}
              style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,.08)",
                border: "none",
                borderRadius: 999,
                color: "#e8e8ec",
                padding: "7px 14px",
                cursor: "pointer",
                fontSize: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
              title="Revenir à la navigation (la lecture continue)"
            >
              <X size={14} /> Réduire
            </button>
          </div>
        </div>

        {/* ----- Colonne « À suivre » ----- */}
        <div style={{ width: 380, flexShrink: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--color-text-muted, #9a9aa3)",
              marginBottom: 10,
            }}
          >
            À suivre ({upNext.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upNext.map((item) => {
              const realIndex = queue.items.indexOf(item);
              return (
                <div
                  key={`${item.id}-${realIndex}`}
                  onClick={() => playQueue(queue.items, realIndex)}
                  style={{
                    display: "flex",
                    gap: 10,
                    cursor: "pointer",
                    padding: 6,
                    borderRadius: 8,
                    transition: "background .15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div
                    style={{
                      position: "relative",
                      width: 148,
                      aspectRatio: "16/9",
                      borderRadius: 6,
                      overflow: "hidden",
                      background: "#000",
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={
                        item.thumbnail ??
                        `https://i.ytimg.com/vi/${item.youtubeId ?? ""}/default.jpg`
                      }
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        lineHeight: 1.3,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-muted, #9a9aa3)",
                        marginTop: 4,
                      }}
                    >
                      {item.channel ?? ""}
                    </div>
                  </div>
                </div>
              );
            })}
            {upNext.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>
                Rien d'autre dans la file.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}