import { useEffect, type CSSProperties } from "react";
import { ArrowLeft, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePlayer, FULLSCREEN_TARGET_ID } from "./PlayerContext";
import { PlayerSurface } from "./PlayerSurface";
import { PlayerControls } from "./PlayerControls";

/** 0.4.0 — Déduit la miniature depuis les métadonnées OU l'URL de lecture. */
function artFromMedia(m: {
  thumbnail?: string;
  youtubeId?: string;
  path: string;
}): string | null {
  if (m.thumbnail) return m.thumbnail;
  if (m.youtubeId) return `https://i.ytimg.com/vi/${m.youtubeId}/hqdefault.jpg`;
  const yt = m.path.match(/[?&]v=([^&]+)/) ?? m.path.match(/youtu\.be\/([^?/&]+)/);
  if (yt) return `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`;
  const dm = m.path.match(/dailymotion\.com\/video\/([^?/&]+)/);
  if (dm) return `https://www.dailymotion.com/thumbnail/video/${dm[1]}`;
  return null;
}

const topBtn: CSSProperties = {
  background: "rgba(255,255,255,.08)",
  border: "none",
  borderRadius: 8,
  color: "#e8e8ec",
  padding: 7,
  cursor: "pointer",
  display: "inline-flex",
};

/**
 * 0.4.0 — Disposition VIDÉO façon YouTube : grand lecteur 16:9 presque au
 * bord gauche, colonne « À suivre » avec miniatures, barre de fenêtre
 * (retour / réduire / plein écran / fermer) en haut.
 */
export function VideoWatchLayout() {
  const {
    queue,
    currentMedia,
    playQueue,
    closeAudioView,
    displayMode,
    setDisplayMode,
    isFullscreen,
    toggleFullscreen,
    isDetached,
  } = usePlayer();

  // 0.4.0 : cette vue ne doit JAMAIS laisser la fenêtre « toujours au-dessus ».
  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(false);
  }, []);

  if (!currentMedia) return null;

  const upNext = queue.items.filter((_, i) => i !== queue.currentIndex);

  const handleBack = () => {
    if (isFullscreen) toggleFullscreen();
    closeAudioView();
  };

  const toggleWindowFullscreen = () => {
    const win = getCurrentWindow();
    void win.isFullscreen().then((f) => win.setFullscreen(!f));
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "var(--color-bg, #0f0f14)",
        overflowY: "auto",
      }}
    >
      {/* ----- Barre supérieure : retour + boutons de fenêtre ----- */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }}>
        <button onClick={handleBack} title="Retour à la page précédente" style={topBtn}>
          <ArrowLeft size={17} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void getCurrentWindow().minimize()}
          title="Réduire la fenêtre"
          style={topBtn}
        >
          <Minus size={15} />
        </button>
        <button onClick={toggleWindowFullscreen} title="Plein écran (fenêtre)" style={topBtn}>
          <Square size={13} />
        </button>
        <button
          onClick={() => void getCurrentWindow().close()}
          title="Fermer AetherVault"
          style={topBtn}
        >
          <X size={16} />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 20,
          padding: "0 16px 40px 10px",
          alignItems: "flex-start",
        }}
      >
        {/* ----- Colonne lecteur ----- */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            id={FULLSCREEN_TARGET_ID}
            className="avm-player avm-player--inline"
            style={{
              position: "relative",
              aspectRatio: "16/9",
              borderRadius: 10,
              overflow: "hidden",
              background: "#000",
            }}
          >
            {isDetached ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#000",
                  color: "var(--color-text-muted, #9a9aa3)",
                  fontSize: 13,
                  zIndex: 2,
                }}
              >
                Vidéo lue dans la fenêtre de lecture détachée.
              </div>
            ) : (
              <>
                <PlayerSurface className="avm-player__surface" />
                <div className="avm-player__controls-wrap">
                  <PlayerControls variant="normal" floatMode="detach" />
                </div>
              </>
            )}
          </div>

          {/* Titre + cadrage + réduire */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <h1
              style={{
                fontSize: 19,
                fontWeight: 800,
                margin: 0,
                flex: 1,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {currentMedia.title}
            </h1>

            <div
              style={{
                display: "flex",
                gap: 4,
                background: "rgba(255,255,255,.06)",
                borderRadius: 999,
                padding: 3,
              }}
            >
              {(
                [
                  ["contain", "Ajuster"],
                  ["cover", "Remplir"],
                  ["stretch", "Étirer"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setDisplayMode(m)}
                  title={`Cadrage : ${label}`}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 999,
                    border: "none",
                    fontSize: 11,
                    cursor: "pointer",
                    background:
                      displayMode === m ? "var(--color-accent, #7c5cff)" : "transparent",
                    color: displayMode === m ? "#fff" : "var(--color-text-muted, #9a9aa3)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={handleBack}
              style={{
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

          <div style={{ marginTop: 6, fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            {currentMedia.channel ?? "AetherFy"}
          </div>
        </div>

        {/* ----- Colonne « À suivre » ----- */}
        <aside style={{ width: 400, flexShrink: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
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
              const itemThumb = artFromMedia(item);
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
                    {itemThumb ? (
                      <img
                        src={itemThumb}
                        alt=""
                        loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "#241b4d",
                          color: "#9a9aa3",
                          fontSize: 10,
                        }}
                      >
                        —
                      </div>
                    )}
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
                      style={{ fontSize: 11, color: "var(--color-text-muted, #9a9aa3)", marginTop: 4 }}
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
        </aside>
      </div>
    </div>
  );
}