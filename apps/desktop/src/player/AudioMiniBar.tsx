import { useEffect, useState } from "react";
import { ChevronUp, Music, Pause, Play, SkipForward } from "lucide-react";
import { usePlayer } from "./PlayerContext";

/** 0.8.0 — même chaîne de candidats pochette que l'overlay immersif :
la mini-barre affiche EXACTEMENT la même image que la liste MusicHub
(maxres HD fourni par la file, repli hqdefault). */
function artChainFromMedia(m: {
  thumbnail?: string | null;
  youtubeId?: string | null;
  path: string;
}): string[] {
  const out: string[] = [];
  if (m.thumbnail) out.push(m.thumbnail);
  let ytId = m.youtubeId ?? null;
  if (!ytId) {
    const yt = m.path.match(/[?&]v=([^&]+)/) ?? m.path.match(/youtu\.be\/([^?/&]+)/);
    ytId = yt?.[1] ?? null;
  }
  if (ytId) {
    out.push(`https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`);
    out.push(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`);
  } else {
    const dm = m.path.match(/dailymotion\.com\/video\/([^?/&]+)/);
    if (dm) out.push(`https://www.dailymotion.com/thumbnail/video/${dm[1]}`);
  }
  return [...new Set(out)];
}

function ArtImg({ chain, style }: { chain: string[]; style?: React.CSSProperties }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [chain[0]]);
  if (chain.length === 0) return null;
  const safe = Math.min(index, chain.length - 1);
  return (
    <img
      src={chain[safe]}
      alt=""
      style={style}
      onError={() => setIndex((i) => Math.min(i + 1, chain.length - 1))}
    />
  );
}

/** 0.4.0 — Mini-barre audio : le lecteur musique se réduit en bas de
l'écran pour le multitâche ; le bouton ⌃ rouvre la vue immersive.
0.8.0 — pochette HD + artiste partagés avec la liste et l'overlay. */
export function AudioMiniBar() {
  const {
    currentMedia,
    isPlaying,
    position,
    duration,
    hasNext,
    togglePlay,
    playNext,
    openImmersive,
  } = usePlayer();
  if (!currentMedia) return null;
  const chain = artChainFromMedia(currentMedia);
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: 64,
        background: "rgba(18,16,24,.97)",
        borderTop: "1px solid rgba(255,255,255,.08)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 16px",
        zIndex: 800,
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Progression fine en haut de la barre */}
      <div
        style={{
          position: "absolute",
          top: -1,
          left: 0,
          height: 2,
          width: `${pct}%`,
          background: "var(--color-accent, #7c5cff)",
          transition: "width .3s linear",
        }}
      />
      {chain.length > 0 ? (
        <ArtImg
          chain={chain}
          style={{ width: 42, height: 42, borderRadius: 6, objectFit: "cover", background: "#000" }}
        />
      ) : (
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 6,
            background: "#241b4d",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Music size={18} style={{ opacity: 0.5 }} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {currentMedia.title}
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
          {currentMedia.channel ?? "AetherFy"}
        </div>
      </div>
      <button
        onClick={togglePlay}
        title={isPlaying ? "Pause" : "Lecture"}
        style={{
          background: "transparent",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          display: "inline-flex",
          padding: 6,
        }}
      >
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      {hasNext && (
        <button
          onClick={playNext}
          title="Suivant"
          style={{
            background: "transparent",
            border: "none",
            color: "#e8e8ec",
            cursor: "pointer",
            display: "inline-flex",
            padding: 6,
          }}
        >
          <SkipForward size={17} />
        </button>
      )}
      <button
        onClick={openImmersive}
        title="Agrandir le lecteur"
        style={{
          background: "rgba(255,255,255,.08)",
          border: "none",
          borderRadius: "50%",
          color: "#e8e8ec",
          cursor: "pointer",
          display: "inline-flex",
          padding: 7,
        }}
      >
        <ChevronUp size={17} />
      </button>
    </div>
  );
}