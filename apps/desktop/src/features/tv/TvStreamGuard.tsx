import { useEffect, useRef, useState } from "react";
import { Power } from "lucide-react";
import { usePlayer } from "../../player/PlayerContext";
import { playerApi } from "../player/api";

/**
 * 0.9.6 — GARDE-FOU TV (page d'accueil des chaînes) :
 *  1) Auto-kill au montage : tout flux TV (id négatif) qui aurait survécu
 *     à la navigation est coupé DIRECTEMENT au niveau mpv
 *     (playerApi.stop = invoke Rust, ne dépend d'aucun événement DOM —
 *     les filets hashchange précédents étaient morts car HashRouter
 *     navigue via pushState, qui ne déclenche PAS hashchange).
 *  2) Bouton kill visible tant qu'un flux TV tourne sur cette page :
 *     contrôle manuel garanti, quoi qu'il arrive.
 */
export function TvStreamGuard() {
  const { currentMedia, stop } = usePlayer();
  const [flash, setFlash] = useState(false);
  const tvActive = !!currentMedia && currentMedia.id < 0;
  const tvActiveRef = useRef(tvActive);
  tvActiveRef.current = tvActive;

  const kill = () => {
    // 1. Coupe l'audio immédiatement (mute)
    void playerApi.setMuted(true).catch(() => {});
    // 2. Stop mpv + contexte
    void playerApi.stop().catch(() => {});
    try {
      stop();
    } catch {
      /* best-effort */
    }
    setFlash(true);
    // 3. Rétablit le son après 300ms (la lecture est coupée de toute façon)
    window.setTimeout(() => {
      void playerApi.setMuted(false).catch(() => {});
      setFlash(false);
    }, 300);
  };

  // Auto-kill UNE fois au montage de la page d'accueil TV.
  useEffect(() => {
    if (tvActiveRef.current) kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!tvActive && !flash) return null;

  return (
    <button
      type="button"
      className="afy-btn-secondary"
      onClick={kill}
      title="Coupe immédiatement le flux HLS au niveau mpv"
      style={{
        borderColor: flash ? "#2ec4b6" : undefined,
        color: flash ? "#2ec4b6" : undefined,
      }}
    >
      <Power size={14} />
      {flash ? "Flux coupé ✓" : "Stop flux"}
    </button>
  );
}