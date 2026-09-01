import { useState } from "react";
import {
  ChevronDown,
  ListMusic,
  Music,
  Pause,
  Pin,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePlayer } from "./PlayerContext";
import { formatDuration } from "../pages/VaultTubeVideoGrid";

/** 0.4.0 — Déduit la miniature depuis les métadonnées OU l'URL de lecture
 * (YouTube / Dailymotion), même si la file ne fournit pas `thumbnail`. */
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

/**
 * 0.4.0 — Lecteur AUDIO façon Spotify (jalon 3) : grande pochette,
 * contrôles (aléatoire, boucle, précédent/suivant), progression, volume
 * et file d'attente cliquable avec « programmer en suivant » (📌).
 */
export function AudioPlayerOverlay() {
  const {
    currentMedia,
    isPlaying,
    position,
    duration,
    volume,
    muted,
    hasNext,
    hasPrevious,
    togglePlay,
    playNext,
    playPrevious,
    seek,
    setVolumeLevel,
    toggleMuted,
    queue,
    playQueue,
    closeAudioView,
    shuffleEnabled,
    toggleShuffle,
    loopEnabled,
    toggleLoop,
    queueNext,
  } = usePlayer();

  const [showQueue, setShowQueue] = useState(true);

  if (!currentMedia) return null;

  const thumb = artFromMedia(currentMedia);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        display: "flex",
        background: "linear-gradient(180deg, #2b1e57 0%, #17131f 55%, #0d0b12 100%)",
      }}
    >
      {/* ----- Colonne principale ----- */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 40px 40px",
          minWidth: 0,
        }}
      >
        <button
          onClick={closeAudioView}
          title="Réduire (la musique continue)"
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            background: "rgba(255,255,255,.08)",
            border: "none",
            borderRadius: "50%",
            color: "#e8e8ec",
            padding: 8,
            cursor: "pointer",
            display: "inline-flex",
          }}
        >
          <ChevronDown size={20} />
        </button>
        <button
          onClick={() => setShowQueue((q) => !q)}
          title="File d'attente"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: showQueue ? "rgba(124,92,255,.35)" : "rgba(255,255,255,.08)",
            border: "none",
            borderRadius: "50%",
            color: "#e8e8ec",
            padding: 8,
            cursor: "pointer",
            display: "inline-flex",
          }}
        >
          <ListMusic size={20} />
        </button>

        {/* Pochette */}
        <div
          style={{
            width: "min(46vh, 420px)",
            aspectRatio: "1/1",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 24px 60px rgba(0,0,0,.6)",
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {thumb ? (
            <img
              src={thumb}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <Music size={72} style={{ opacity: 0.4 }} />
          )}
        </div>

        {/* Titre / artiste */}
        <div
          style={{
            marginTop: 28,
            textAlign: "center",
            maxWidth: "80%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {currentMedia.title}
        </div>
        <div
          style={{
            marginTop: 6,
            color: "var(--color-text-muted, #9a9aa3)",
            fontSize: 14,
            maxWidth: "80%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {currentMedia.channel ?? "AetherFy"}
        </div>

        {/* Progression */}
        <div style={{ width: "min(560px, 90%)", marginTop: 30 }}>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={Math.min(position, duration || position)}
            onChange={(e) => seek(Number(e.target.value))}
            className="avm-audio-range"
            style={{ width: "100%" }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: "var(--color-text-muted, #9a9aa3)",
              marginTop: 4,
              fontFamily: "monospace",
            }}
          >
            <span>{formatDuration(position)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        {/* Contrôles : aléatoire / précédent / lecture / suivant / boucle */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 18 }}>
          <button
            onClick={toggleShuffle}
            title="Lecture aléatoire"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              padding: 6,
              color: shuffleEnabled ? "#1db954" : "#8a8a93",
            }}
          >
            <Shuffle size={17} />
          </button>
          <button
            onClick={playPrevious}
            disabled={!hasPrevious}
            title="Précédent"
            style={{
              background: "transparent",
              border: "none",
              color: hasPrevious ? "#e8e8ec" : "#555",
              cursor: hasPrevious ? "pointer" : "default",
              display: "inline-flex",
              padding: 6,
            }}
          >
            <SkipBack size={26} />
          </button>
          <button
            onClick={togglePlay}
            title={isPlaying ? "Pause" : "Lecture"}
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "#fff",
              border: "none",
              color: "#111",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(0,0,0,.5)",
            }}
          >
            {isPlaying ? <Pause size={28} /> : <Play size={28} style={{ marginLeft: 3 }} />}
          </button>
          <button
            onClick={playNext}
            disabled={!hasNext}
            title="Suivant"
            style={{
              background: "transparent",
              border: "none",
              color: hasNext ? "#e8e8ec" : "#555",
              cursor: hasNext ? "pointer" : "default",
              display: "inline-flex",
              padding: 6,
            }}
          >
            <SkipForward size={26} />
          </button>
          <button
            onClick={toggleLoop}
            title="Boucle"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              padding: 6,
              color: loopEnabled ? "#1db954" : "#8a8a93",
            }}
          >
            <Repeat size={17} />
          </button>
        </div>

        {/* Volume */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22 }}>
          <button
            onClick={toggleMuted}
            title={muted ? "Réactiver le son" : "Couper le son"}
            style={{
              background: "transparent",
              border: "none",
              color: "#e8e8ec",
              cursor: "pointer",
              display: "inline-flex",
              padding: 4,
            }}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : volume}
            onChange={(e) => setVolumeLevel(Number(e.target.value))}
            className="avm-audio-range"
            style={{ width: 140 }}
          />
        </div>
      </div>

      {/* ----- File d'attente ----- */}
      {showQueue && (
        <div
          style={{
            width: 340,
            borderLeft: "1px solid rgba(255,255,255,.08)",
            background: "rgba(0,0,0,.35)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "18px 18px 10px",
              fontWeight: 700,
              fontSize: 14,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--color-text-muted, #9a9aa3)",
            }}
          >
            File d'attente ({queue.items.length})
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 10px 16px" }}>
            {queue.items.map((item, i) => {
              const isCurrent = i === queue.currentIndex;
              const itemThumb = artFromMedia(item);
              return (
                <div
                  key={`${item.id}-${i}`}
                  className="avm-af-queue-row"
                  onClick={() => playQueue(queue.items, i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 8px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: isCurrent ? "rgba(124,92,255,.22)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "rgba(255,255,255,.06)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      textAlign: "center",
                      fontSize: 11,
                      color: isCurrent ? "#c4b5ff" : "var(--color-text-muted, #9a9aa3)",
                      fontFamily: "monospace",
                    }}
                  >
                    {i + 1}
                  </span>
                  {itemThumb ? (
                    <img
                      src={itemThumb}
                      alt=""
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 6,
                        objectFit: "cover",
                        background: "#000",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 6,
                        background: "#241b4d",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Music size={16} style={{ opacity: 0.5 }} />
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: isCurrent ? 700 : 500,
                        color: isCurrent ? "#c4b5ff" : "#e8e8ec",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-muted, #9a9aa3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.channel ?? ""}
                    </div>
                  </div>
                  <button
                    className="avm-q-next"
                    title="Programmer comme prochaine lecture"
                    onClick={(e) => {
                      e.stopPropagation();
                      queueNext(i);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#8a8a93",
                      cursor: "pointer",
                      display: "inline-flex",
                      padding: 4,
                      opacity: 0,
                      transition: "opacity .15s ease",
                    }}
                  >
                    <Pin size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}