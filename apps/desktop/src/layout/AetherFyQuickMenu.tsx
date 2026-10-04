import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  Disc3,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  Radio,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { PlayableMedia } from "@aethervault/shared-types";
import { usePlayer } from "../player/PlayerContext";
import "./aetherfyQuickMenu.css"; // uniquement pour l'animation .afq__spin

/* 0.6.4 — Raccourci TopBar « AetherFy » : mini-lecteur + playlists +
   abonnements, panneau portalisé dans <body> (échappe à tous les
   stacking contexts : backdrop-filter de la TopBar, transitions
   framer-motion) → toujours AU-DESSUS de l'interface.
   0.6.4e — CORRECTIF POLICE : le portal sort du wrapper qui porte la
   police de l'app (thème / typographie) → polices navigateur par
   défaut. On lit la police CALCULÉE depuis l'en-tête (dans l'arbre
   thémé, via le déclencheur) à l'ouverture, on l'applique au panneau,
   et chaque <button> interne reçoit fontFamily: "inherit" (un bouton
   n'hérite JAMAIS de la police par défaut en CSS). */

interface QtPlaylist {
  id: number;
  name: string;
  mode: string;
}
interface QtPlaylistItem {
  id: number;
  youtube_id: string;
  title: string;
  thumbnail_url: string | null;
  source: string;
}
interface QtSubscription {
  id: number;
  name: string;
  kind: string;
  mode: string;
}
interface QtVideo {
  id: number;
  youtube_id: string;
  title: string;
  thumbnail_url: string | null;
  source: string;
}

const VAULT_ID_OFFSET = 1_000_000_000;

function watchUrl(source: string, youtubeId: string): string {
  if (source === "dailymotion") return `https://www.dailymotion.com/video/${youtubeId}`;
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}
function toMode(mode: string): "audio" | "video" {
  return mode === "video" ? "video" : "audio";
}

/* ----- styles inline ----- */
const wrapStyle: CSSProperties = { position: "relative", display: "inline-flex" };
const triggerStyle = (open: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  borderRadius: 10,
  border: open ? "1px solid rgba(124,92,255,.4)" : "1px solid transparent",
  background: open ? "rgba(124,92,255,.16)" : "transparent",
  color: open ? "var(--color-accent, #7c5cff)" : "var(--color-text-soft, #cbd5e1)",
  cursor: "pointer",
  flexShrink: 0,
  fontFamily: "inherit",
});
/* 0.6.4e : `font` = police calculée de l'en-tête, appliquée explicitement
   (le panneau vit dans <body>, hors de l'arbre thémé). */
const panelStyle = (
  anchor: { top: number; right: number },
  font: string | null
): CSSProperties => ({
  position: "fixed",
  top: anchor.top,
  right: anchor.right,
  width: 320,
  background: "var(--color-surface, #16161c)",
  border: "1px solid var(--color-border, #2c2c33)",
  borderRadius: 14,
  boxShadow: "0 24px 56px rgba(0,0,0,.6)",
  padding: 12,
  zIndex: 2147483000,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  maxHeight: `min(72vh, ${Math.max(200, window.innerHeight - anchor.top - 12)}px)`,
  overflowY: "auto",
  fontFamily: font ?? "inherit",
});
const playerRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const thumbBoxStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 9,
  overflow: "hidden",
  background: "#000",
  border: "1px solid var(--color-border, #2c2c33)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--color-text-muted, #9a9aa3)",
  flexShrink: 0,
};
const metaColStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const titleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text, #f2f2f5)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const progressTrackStyle: CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: "rgba(255,255,255,.12)",
  cursor: "pointer",
  overflow: "hidden",
};
const controlsStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 };
/* 0.6.4e : fontFamily inherit — sinon police UA sur les boutons. */
const ctlStyle = (main = false): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: main ? 28 : 26,
  height: main ? 28 : 26,
  borderRadius: 8,
  border: "none",
  background: main ? "rgba(124,92,255,.18)" : "transparent",
  color: main ? "var(--color-accent, #7c5cff)" : "var(--color-text-soft, #cbd5e1)",
  cursor: "pointer",
  fontFamily: "inherit",
});
const sepStyle: CSSProperties = { height: 1, background: "var(--color-border, #2c2c33)" };
const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1.1,
  textTransform: "uppercase",
  color: "var(--color-text-muted, #64748b)",
};
const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  maxHeight: 168,
  overflowY: "auto",
};
const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  padding: "8px 9px",
  borderRadius: 9,
  border: "none",
  background: "transparent",
  color: "var(--color-text-soft, #cbd5e1)",
  fontSize: 13,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
};
const itemNameStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const itemBadgeStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--color-text-muted, #64748b)",
  border: "1px solid var(--color-border, #2c2c33)",
  borderRadius: 8,
  padding: "1px 7px",
  flexShrink: 0,
};
const emptyStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: "var(--color-text-muted, #9a9aa3)",
  padding: "6px 2px",
};

export function AetherFyQuickMenu() {
  const {
    currentMedia,
    isPlaying,
    position,
    duration,
    togglePlay,
    playNext,
    playPrevious,
    playQueueBackground,
    seek,
  } = usePlayer();

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  /* 0.6.4e : police calculée de l'en-tête (arbre thémé) — appliquée au
     panneau portalisé dans <body>. */
  const [appFont, setAppFont] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<QtPlaylist[]>([]);
  const [subscriptions, setSubscriptions] = useState<QtSubscription[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  /* Fermeture : clic extérieur (bouton ET panneau), Échap, scroll, resize. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  /* 0.6.4e : à l'ouverture, capture la police réelle de l'application
     depuis l'en-tête (le déclencheur y vit) — jamais depuis <body>. */
  useEffect(() => {
    if (!open) return;
    const host =
      triggerRef.current?.closest("header") ??
      triggerRef.current?.parentElement ??
      document.body;
    setAppFont(window.getComputedStyle(host).fontFamily);
  }, [open]);

  const loadAll = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const [pls, subs] = await Promise.all([
        invoke<QtPlaylist[]>("vaulttube_list_user_playlists"),
        invoke<QtSubscription[]>("vaulttube_list_subscriptions"),
      ]);
      setPlaylists(pls);
      setSubscriptions(subs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contenu AetherFy indisponible.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadAll();
  }, [open, loadAll]);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((o) => !o);
  };

  const startQueue = (queue: PlayableMedia[], label: string) => {
    if (queue.length === 0) {
      setError(`« ${label} » est vide.`);
      return;
    }
    playQueueBackground(queue, 0);
    setOpen(false);
  };

  const playPlaylist = async (pl: QtPlaylist) => {
    setLoadingKey(`pl:${pl.id}`);
    setError(null);
    try {
      const items = await invoke<QtPlaylistItem[]>("vaulttube_list_user_playlist_items", {
        playlistId: pl.id,
      });
      const mode = toMode(pl.mode);
      startQueue(
        items.map(
          (it) =>
            ({
              id: it.id + VAULT_ID_OFFSET,
              title: it.title,
              path: watchUrl(it.source, it.youtube_id),
              libraryId: 0,
              mode,
              poster: it.thumbnail_url,
            }) as PlayableMedia
        ),
        pl.name
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lecture impossible.");
    } finally {
      setLoadingKey(null);
    }
  };

  const playSubscription = async (sub: QtSubscription) => {
    setLoadingKey(`sub:${sub.id}`);
    setError(null);
    try {
      const videos = await invoke<QtVideo[]>("vaulttube_list_videos", {
        subscriptionId: sub.id,
      });
      const mode = toMode(sub.mode);
      startQueue(
        videos.map(
          (v) =>
            ({
              id: v.id + VAULT_ID_OFFSET,
              title: v.title,
              path: watchUrl(v.source, v.youtube_id),
              libraryId: 0,
              mode,
              poster: v.thumbnail_url,
            }) as PlayableMedia
        ),
        sub.name
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lecture impossible.");
    } finally {
      setLoadingKey(null);
    }
  };

  const poster =
    (currentMedia as unknown as { poster?: string | null } | null)?.poster ?? null;
  const thumbSrc = poster
    ? poster.startsWith("http")
      ? poster
      : convertFileSrc(poster)
    : null;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  const handleProgressClick = (e: MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seek(ratio * duration);
  };

  return (
    <div ref={rootRef} style={wrapStyle}>
      <button
        ref={triggerRef}
        type="button"
        style={triggerStyle(open)}
        title="AetherFy — playlists & mini-lecteur"
        aria-label="AetherFy — playlists & mini-lecteur"
        onClick={(e) => {
          e.stopPropagation();
          toggleOpen();
        }}
      >
        <Disc3 size={18} className={isPlaying ? "afq__spin" : undefined} />
      </button>

      {open &&
        anchor &&
        createPortal(
          <div ref={panelRef} style={panelStyle(anchor, appFont)} role="menu" aria-label="AetherFy">
            {/* ----- Mini-lecteur ----- */}
            <div style={playerRowStyle}>
              <div style={thumbBoxStyle}>
                {thumbSrc ? (
                  <img
                    src={thumbSrc}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <Music size={16} />
                )}
              </div>
              <div style={metaColStyle}>
                <span style={titleStyle} title={currentMedia?.title ?? ""}>
                  {currentMedia?.title ?? "Rien en lecture"}
                </span>
                <div style={progressTrackStyle} onClick={handleProgressClick} title="Cliquer pour naviguer">
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      borderRadius: 2,
                      background: "linear-gradient(90deg, #8b5cf6, #6366f1, #22d3ee)",
                    }}
                  />
                </div>
              </div>
              <div style={controlsStyle}>
                <button type="button" style={ctlStyle()} title="Piste précédente" onClick={playPrevious}>
                  <SkipBack size={14} />
                </button>
                <button
                  type="button"
                  style={ctlStyle(true)}
                  title={isPlaying ? "Pause" : "Lecture"}
                  onClick={togglePlay}
                  disabled={!currentMedia}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button type="button" style={ctlStyle()} title="Piste suivante" onClick={playNext}>
                  <SkipForward size={14} />
                </button>
              </div>
            </div>

            <div style={sepStyle} />

            {/* ----- Playlists personnelles ----- */}
            <div>
              <div style={labelStyle}>Playlists AetherFy</div>
              <div style={listStyle}>
                {loadingList ? (
                  <span style={emptyStyle}>
                    <Loader2 size={14} className="afq__spin" /> Chargement…
                  </span>
                ) : playlists.length === 0 ? (
                  <span style={emptyStyle}>Aucune playlist personnelle.</span>
                ) : (
                  playlists.map((pl) => (
                    <button
                      key={`pl-${pl.id}`}
                      type="button"
                      style={itemStyle}
                      disabled={loadingKey !== null}
                      onClick={() => void playPlaylist(pl)}
                      title={`Lire « ${pl.name} »`}
                    >
                      {loadingKey === `pl:${pl.id}` ? (
                        <Loader2 size={14} className="afq__spin" />
                      ) : (
                        <ListMusic size={14} />
                      )}
                      <span style={itemNameStyle}>{pl.name}</span>
                      <span style={itemBadgeStyle}>
                        {toMode(pl.mode) === "audio" ? "musique" : "vidéo"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* ----- Abonnements ----- */}
            <div>
              <div style={labelStyle}>Abonnements</div>
              <div style={listStyle}>
                {loadingList ? (
                  <span style={emptyStyle}>
                    <Loader2 size={14} className="afq__spin" /> Chargement…
                  </span>
                ) : subscriptions.length === 0 ? (
                  <span style={emptyStyle}>Aucun abonnement.</span>
                ) : (
                  subscriptions.map((sub) => (
                    <button
                      key={`sub-${sub.id}`}
                      type="button"
                      style={itemStyle}
                      disabled={loadingKey !== null}
                      onClick={() => void playSubscription(sub)}
                      title={`Lire « ${sub.name} »`}
                    >
                      {loadingKey === `sub:${sub.id}` ? (
                        <Loader2 size={14} className="afq__spin" />
                      ) : (
                        <Radio size={14} />
                      )}
                      <span style={itemNameStyle}>{sub.name}</span>
                      <span style={itemBadgeStyle}>
                        {toMode(sub.mode) === "audio" ? "musique" : "vidéo"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: "#fb7185", padding: "2px 2px 0" }}>{error}</div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}