import { useEffect, useRef, useState } from "react";
import { loadYouTubeApi } from "./youtubeApi";
import "./hero-trailer.css";

interface HeroTrailerProps {
  /** Clés YouTube à essayer dans l'ordre (la suivante est tentée si l'une échoue). */
  keys: string[];
  muted: boolean;
  /** Appelé quand la lecture démarre réellement (la bannière peut alors s'effacer). */
  onPlaying: () => void;
}

/**
 * Bande-annonce muette en boucle, derrière le texte du Héro. Elle ne s'affiche
 * (fondu) qu'une fois la lecture réellement lancée : tant que ce n'est pas le
 * cas — hors ligne, vidéo indisponible — la bannière reste visible. La lecture
 * se met en pause quand le Héro sort de l'écran ou que la fenêtre est masquée.
 */
export function HeroTrailer({ keys, muted, onPlaying }: HeroTrailerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const mutedRef = useRef(muted);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const key = keys[index];
  mutedRef.current = muted;

  useEffect(() => {
    if (!key || !hostRef.current) return;
    let cancelled = false;
    setPlaying(false);
    void loadYouTubeApi().then((YT) => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      // L'API remplace l'élément reçu par une iframe : on lui donne un nœud neuf à chaque fois.
      const mount = document.createElement("div");
      host.replaceChildren(mount);
      playerRef.current = new YT.Player(mount, {
        width: "100%",
        height: "100%",
        videoId: key,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          loop: 1,
          playlist: key,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          mute: 1,
        },
        events: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onReady: (event: any) => {
            try {
              event.target.unloadModule("captions");
              event.target.unloadModule("cc");
            } catch {
              // best-effort
            }
            if (mutedRef.current) event.target.mute();
            else event.target.unMute();
            event.target.playVideo();
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onStateChange: (event: any) => {
            if (event.data === 1 && !cancelled) {
              setPlaying(true);
              onPlaying();
            }
          },
          onError: () => setIndex((i) => (i + 1 < keys.length ? i + 1 : i)),
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // best-effort
      }
      playerRef.current = null;
      hostRef.current?.replaceChildren();
    };
    // `keys` ne change pas pendant la vie du composant (le parent le remonte au besoin).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (muted) player.mute();
      else player.unMute();
    } catch {
      // le lecteur n'est pas encore prêt : onReady appliquera `mutedRef`
    }
  }, [muted]);

  // Économie de ressources : pause hors de l'écran / fenêtre masquée.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let visible = true;
    const sync = () => {
      const player = playerRef.current;
      if (!player) return;
      try {
        if (visible && !document.hidden) player.playVideo();
        else player.pauseVideo();
      } catch {
        // best-effort
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        sync();
      },
      { threshold: 0.2 }
    );
    observer.observe(host);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`avm-home-hero__trailer${playing ? " avm-home-hero__trailer--on" : ""}`}
      aria-hidden="true"
    />
  );
}
