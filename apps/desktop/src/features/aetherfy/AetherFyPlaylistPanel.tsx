import { memo, useCallback, useEffect, useState } from "react";
import type { UIEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Repeat, Shuffle, X } from "lucide-react";
import type { VaultTubeVideo } from "../vaulttube/api";

/** Nombre d'éléments rendus d'un coup (la file d'un abonnement peut en compter
 *  plusieurs milliers). */
const WINDOW = 60;

interface Props {
  playlist: VaultTubeVideo[];
  /** `youtube_id` de la vidéo en cours de lecture. */
  activeYoutubeId: string;
  sideTitle: string;
  playlistId: number | null;
  /** Clé de la playlist de chaîne en cours (voir `playlistSession.ts`). */
  playlistKey: string | null;
  playlistTitle: string | null;
  loop: boolean;
  shuffle: boolean;
  onToggleLoop: () => void;
  onToggleShuffle: () => void;
  onClose: () => void;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(seconds?: number | null): string {
  return seconds ? formatClock(seconds) : "";
}

/**
 * File de lecture de la page AetherFy.
 *
 * Extraite de `AetherFyWatchPage` pour deux raisons mesurées sur une capture
 * d'écran (file de 2 064 vidéos) : (1) la page rendait TOUS les éléments
 * (~20 000 nœuds DOM, 2 064 miniatures chargées d'un coup) ; (2) comme elle
 * lit la position du lecteur, elle se re-rendait à chaque événement de
 * position (30 à 60 fois par seconde) et saturait le thread JavaScript : la
 * vidéo n'affichait que ~6 images/s dans la page alors que, dans la fenêtre
 * PiP (qui n'a pas cette liste), elle était parfaitement fluide.
 *
 * Ici : composant mémoïsé (ses props ne changent pas à chaque tick) et rendu
 * par fenêtres de `WINDOW` éléments, étendues au défilement.
 */
function AetherFyPlaylistPanelImpl({
  playlist,
  activeYoutubeId,
  sideTitle,
  playlistId,
  playlistKey,
  playlistTitle,
  loop,
  shuffle,
  onToggleLoop,
  onToggleShuffle,
  onClose,
}: Props) {
  const navigate = useNavigate();
  const activeIndex = playlist.findIndex((v) => v.youtube_id === activeYoutubeId);

  const [from, setFrom] = useState(() => Math.max(0, activeIndex - 2));
  const [count, setCount] = useState(WINDOW);

  // La vidéo en cours doit toujours faire partie de la fenêtre affichée
  // (passage au morceau suivant, nouvelle playlist…).
  useEffect(() => {
    if (activeIndex < 0) return;
    if (activeIndex < from || activeIndex >= from + count) {
      setFrom(Math.max(0, activeIndex - 2));
      setCount(WINDOW);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, playlist]);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
        setCount((c) => (from + c < playlist.length ? c + WINDOW : c));
      }
    },
    [from, playlist.length]
  );

  const showPrevious = useCallback(() => {
    const next = Math.max(0, from - WINDOW);
    setCount((c) => c + (from - next));
    setFrom(next);
  }, [from]);

  const end = Math.min(playlist.length, from + count);
  const visible = playlist.slice(from, end);

  return (
    <div className="afy-playlist">
      <div className="afy-playlist__head">
        <div>
          <div className="afy-playlist__title">{sideTitle}</div>
          <div className="afy-playlist__sub">
            {activeIndex + 1} / {playlist.length}
          </div>
        </div>
        <div className="afy-playlist__actions">
          <button
            type="button"
            className="afy-playlist__icon-btn"
            onClick={onToggleLoop}
            title="Répéter"
            aria-pressed={loop}
            style={{ color: loop ? "#ff9f1c" : undefined }}
          >
            <Repeat size={16} />
          </button>
          <button
            type="button"
            className="afy-playlist__icon-btn"
            onClick={onToggleShuffle}
            title="Aléatoire"
            aria-pressed={shuffle}
            style={{ color: shuffle ? "#ff9f1c" : undefined }}
          >
            <Shuffle size={16} />
          </button>
          <button
            type="button"
            className="afy-playlist__icon-btn"
            onClick={onClose}
            title="Fermer"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="afy-playlist__list" onScroll={onScroll}>
        {from > 0 && (
          <button type="button" className="afy-playlist-item" onClick={showPrevious}>
            Afficher les {Math.min(WINDOW, from)} précédentes
          </button>
        )}
        {visible.map((v, i) => {
          const idx = from + i;
          const isActive = v.youtube_id === activeYoutubeId;
          return (
            <button
              key={`${v.source}-${v.youtube_id}`}
              type="button"
              className={`afy-playlist-item${isActive ? " afy-playlist-item--active" : ""}`}
              onClick={() =>
                navigate(`/aetherfy/watch/${v.youtube_id}`, {
                  state: {
                    video: v,
                    playlistId: playlistId ?? undefined,
                    playlistKey: playlistKey ?? undefined,
                    playlistTitle: playlistTitle ?? undefined,
                  },
                })
              }
            >
              <span className="afy-playlist-item__index">{idx + 1}</span>
              <div className="afy-playlist-item__thumb">
                {v.thumbnail_url && (
                  <img src={v.thumbnail_url} alt="" loading="lazy" decoding="async" />
                )}
                {isActive && (
                  <div className="afy-playlist-item__playing-icon">
                    <Play size={18} fill="#ff9f1c" />
                  </div>
                )}
                {!isActive && v.duration_seconds && (
                  <span className="afy-playlist-item__thumb-duration">
                    {formatDuration(v.duration_seconds)}
                  </span>
                )}
              </div>
              <div className="afy-playlist-item__info">
                <div className="afy-playlist-item__title">{v.title}</div>
                <div className="afy-playlist-item__channel">
                  {sideTitle}
                  {isActive && " • lecture en cours"}
                </div>
              </div>
              {v.duration_seconds && (
                <span className="afy-playlist-item__duration">
                  {formatDuration(v.duration_seconds)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const AetherFyPlaylistPanel = memo(AetherFyPlaylistPanelImpl);
