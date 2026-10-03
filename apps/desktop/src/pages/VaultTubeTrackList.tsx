import { useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { formatDuration } from "./VaultTubeVideoGrid";
import "./pages.css";

/**
 * FONCTIONNALITÉ (refonte UI AetherFy, Phase 2 — habillage « Musique
 * façon Spotify ») : liste dense de pistes — pochette carrée, numéro
 * qui se change en ▶ au survol de la ligne, durée alignée à droite,
 * actions (réordonner/retirer…) visibles seulement au survol.
 *
 * Volontairement générique : ce composant ne connaît ni `VaultTubeVideo`
 * ni `UserPlaylistItem` — chaque page normalise ses éléments en
 * `TrackListItem` avant de les passer ici (quelques lignes de `.map()`,
 * voir `VaultTubeUserPlaylistPage.tsx`/`VaultTubeVideosPage.tsx`).
 * N'est utilisé que pour le mode "audio" ; le mode "video" garde
 * `VaultTubeVideoGrid` (grille façon YouTube), entièrement inchangée.
 */
export interface TrackListItem {
  key: string | number;
  title: string;
  subtitle?: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
}

export function VaultTubeTrackList({
  items,
  onPlay,
  renderActions,
}: {
  items: TrackListItem[];
  onPlay: (index: number) => void;
  /** Boutons additionnels par ligne (réordonner, retirer…), affichés au survol. */
  renderActions?: (index: number) => ReactNode;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (items.length === 0) return null;

  return (
    <div className="avm-af-tracklist">
      {items.map((item, index) => (
        <div
          key={item.key}
          className="avm-af-track"
          onMouseEnter={() => setHovered(index)}
          onMouseLeave={() => setHovered((h) => (h === index ? null : h))}
          onClick={() => onPlay(index)}
        >
          <span className="avm-af-track__index">
            {hovered === index ? <Play size={13} fill="currentColor" /> : index + 1}
          </span>
          <div className="avm-af-track__art">
            {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" />}
          </div>
          <div className="avm-af-track__info">
            <div className="avm-af-track__title">{item.title}</div>
            {item.subtitle && <div className="avm-af-track__subtitle">{item.subtitle}</div>}
          </div>
          <span className="avm-af-track__duration">{formatDuration(item.durationSeconds)}</span>
          {renderActions && (
            <div className="avm-af-track__actions" onClick={(e) => e.stopPropagation()}>
              {renderActions(index)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
