import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Music, Radio, Video } from "lucide-react";
import {
  vaultTubeApi,
  type PlaybackMode,
  type UserPlaylist,
  type VaultTubeSubscription,
} from "../features/vaulttube/api";
import "./aetherfy-gateway.css";

/**
 * Page de transition AetherFy (tuile « AetherFy » de l'accueil) : deux
 * « portails » — AetherFy Vidéo (`/aetherfy`) et AetherFy Musique
 * (`/vaulttube/music`), mêmes destinations que les entrées de la sidebar.
 *
 * Le fond reste transparent : c'est celui du logiciel (AppBackdrop /
 * thème) qui apparaît derrière. Les compteurs viennent des mêmes
 * commandes que `VaultTubePage` (chaînes suivies + playlists locales,
 * triées par `mode`) ; le dernier portail choisi est simplement mémorisé
 * pour être signalé à la visite suivante.
 */

interface Counts {
  channels: number;
  playlists: number;
}

const LAST_KEY = "afy-gate-last";

const PORTALS: ReadonlyArray<{
  mode: PlaybackMode;
  route: string;
  label: string;
  description: string;
  Icon: typeof Video;
}> = [
  {
    mode: "video",
    route: "/aetherfy",
    label: "Vidéo",
    description: "Vos chaînes, playlists et recommandations, sur grand écran.",
    Icon: Video,
  },
  {
    mode: "audio",
    route: "/vaulttube/music",
    label: "Musique",
    description: "Playlists et chaînes musicales, avec le visualiseur.",
    Icon: Music,
  },
];

/** Barres de l'égaliseur : valeurs fixes (pas de hasard → rendu stable). */
const EQ_BARS = Array.from({ length: 28 }, (_, i) => ({
  delay: -(((i * 37) % 100) / 100) * 1.4,
  duration: 0.8 + ((i * 53) % 70) / 100,
  peak: 35 + ((i * 29) % 60),
}));

function describe(counts: Counts | undefined): string {
  if (!counts) return "\u00a0";
  const parts: string[] = [];
  if (counts.channels > 0) {
    parts.push(`${counts.channels} chaîne${counts.channels > 1 ? "s" : ""}`);
  }
  if (counts.playlists > 0) {
    parts.push(`${counts.playlists} playlist${counts.playlists > 1 ? "s" : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Rien de suivi pour l'instant";
}

function readLast(): PlaybackMode | null {
  try {
    const value = localStorage.getItem(LAST_KEY);
    return value === "video" || value === "audio" ? value : null;
  } catch {
    return null;
  }
}

export function AetherFyGatewayPage() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Record<PlaybackMode, Counts> | null>(null);
  const [last] = useState<PlaybackMode | null>(readLast);
  const portalRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      vaultTubeApi.listSubscriptions().catch(() => [] as VaultTubeSubscription[]),
      vaultTubeApi.listUserPlaylists().catch(() => [] as UserPlaylist[]),
    ]).then(([subscriptions, playlists]) => {
      if (!alive) return;
      const next: Record<PlaybackMode, Counts> = {
        video: { channels: 0, playlists: 0 },
        audio: { channels: 0, playlists: 0 },
      };
      for (const s of subscriptions) {
        if (s.mode === "video" || s.mode === "audio") next[s.mode].channels += 1;
      }
      for (const p of playlists) {
        if (p.mode === "video" || p.mode === "audio") next[p.mode].playlists += 1;
      }
      setCounts(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const enter = (mode: PlaybackMode, route: string) => {
    try {
      localStorage.setItem(LAST_KEY, mode);
    } catch {
      /* stockage indisponible : le choix n'est simplement pas mémorisé */
    }
    navigate(route);
  };

  // Projecteur qui suit le curseur (variables lues par la feuille de style).
  const trackPointer = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  // ← / → : passer d'un portail à l'autre au clavier.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const index = portalRefs.current.findIndex((el) => el === document.activeElement);
    if (index === -1) return;
    e.preventDefault();
    const target = e.key === "ArrowRight" ? Math.min(index + 1, PORTALS.length - 1) : Math.max(index - 1, 0);
    portalRefs.current[target]?.focus();
  };

  return (
    <div className="afy-gate">
      <header className="afy-gate__hero">
        <div className="afy-gate__emblem" aria-hidden="true">
          <Radio size={28} color="#fff" />
        </div>
        <span className="afy-gate__kicker">Streaming multi-sources</span>
        <h1 className="afy-gate__wordmark">
          <span className="avm-brand-aetherfy">AetherFy</span>
        </h1>
        <p className="afy-gate__lead">Choisis ta fréquence</p>
      </header>

      <div className="afy-gate__portals" onKeyDown={onKeyDown}>
        {PORTALS.map(({ mode, route, label, description, Icon }, index) => (
          <button
            key={mode}
            ref={(el) => {
              portalRefs.current[index] = el;
            }}
            type="button"
            className={`afy-gate__portal afy-gate__portal--${mode}`}
            onMouseMove={trackPointer}
            onClick={() => enter(mode, route)}
            aria-label={`AetherFy ${label}`}
          >
            {last === mode && <span className="afy-gate__last">Dernier choix</span>}

            <span className={`afy-gate__art afy-gate__art--${mode}`} aria-hidden="true">
              {mode === "video" ? (
                <>
                  <span className="afy-gate__card afy-gate__card--1" />
                  <span className="afy-gate__card afy-gate__card--2" />
                  <span className="afy-gate__screen">
                    <span className="afy-gate__play" />
                    <span className="afy-gate__progress" />
                  </span>
                </>
              ) : (
                <>
                  <span className="afy-gate__disc" />
                  <span className="afy-gate__eq">
                    {EQ_BARS.map((bar, i) => (
                      <span
                        key={i}
                        style={
                          {
                            "--d": `${bar.delay.toFixed(2)}s`,
                            "--t": `${bar.duration.toFixed(2)}s`,
                            "--h": `${bar.peak}%`,
                          } as CSSProperties
                        }
                      />
                    ))}
                  </span>
                </>
              )}
            </span>

            <span className="afy-gate__body">
              <span className="afy-gate__label">
                <Icon size={14} />
                {mode === "video" ? "Regarder" : "Écouter"}
              </span>
              <span className="afy-gate__title">
                <span className="avm-brand-aetherfy">AetherFy</span> {label}
              </span>
              <span className="afy-gate__desc">{description}</span>
              <span className="afy-gate__stat">{describe(counts?.[mode])}</span>
              <span className="afy-gate__cta">
                Entrer <ArrowRight size={15} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
