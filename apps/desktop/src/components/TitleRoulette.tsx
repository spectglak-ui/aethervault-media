import { useEffect, useMemo, useRef, useState } from "react";
import { Play, RefreshCw, X } from "lucide-react";
import { Button, IconButton } from "@aethervault/ui-kit";
import type { TitleSummary } from "@aethervault/shared-types";
import { assetUrl } from "../lib/assetUrl";

const CARD_W = 160;
const GAP = 12;
const STEP = CARD_W + GAP;
/** Durée du spin — 8 s (retour utilisateur). Constante à ajuster. */
const SPIN_MS = 8000;

/** Ambiances sonores de la roulette (Étape 8) :
 * - "modern" : tic-tic décélérant + carillon doux, 100 % Web Audio
 *   (synthétisé, aucun fichier) ;
 * - "yoooo"  : mêmes tic-tic + le cri japonais « YOOOOOO » à la
 *   révélation (fichier `public/sounds/yoooo.mp3`, muet si absent) ;
 * - "off"    : silence. Choix mémorisé en localStorage. */
type RouletteSound = "off" | "modern" | "yoooo";
const SOUND_STORAGE_KEY = "avm-roulette-sound";

function readStoredSound(): RouletteSound {
  try {
    const stored = localStorage.getItem(SOUND_STORAGE_KEY);
    if (stored === "off" || stored === "modern" || stored === "yoooo") return stored;
  } catch {
    // stockage indisponible : défaut
  }
  return "modern";
}

/** Tic-tic de spin : petit blip sinusoïdal, enveloppe courte. */
function playTick(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 900 + Math.random() * 300;
  gain.gain.setValueAtTime(0.07, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.07);
}

/** Carillon « moderne » de révélation : deux sinusoïdes douces. */
function playChime(ctx: AudioContext) {
  [660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.12;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

interface TitleRouletteProps {
  titles: TitleSummary[];
  categoryName: string;
  onClose: () => void;
  onPlay: (title: TitleSummary) => void;
}

/**
 * Roulette « quoi regarder ce soir ? » (Étape 8) : le gagnant est tiré au
 * sort AVANT l'animation et placé à un index connu ; la piste défile
 * 8 s en décélérant pour l'amener pile au centre du viseur (déterministe).
 * Machine à 3 phases ("reset" → "spinning" → "done") : le replay
 * s'anime toujours. Ne lance JAMAIS la lecture : « Lecture » / « Rejouer ».
 */
export function TitleRoulette({ titles, categoryName, onClose, onPlay }: TitleRouletteProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<"reset" | "spinning" | "done">("reset");
  const [offset, setOffset] = useState(0);
  const [sound, setSound] = useState<RouletteSound>(readStoredSound);

  const { track, winnerIndex, winner } = useMemo(() => {
    if (titles.length === 0) {
      return { track: [] as TitleSummary[], winnerIndex: 0, winner: null as TitleSummary | null };
    }
    const winnerPick = titles[Math.floor(Math.random() * titles.length)];
    const repeats = Math.max(3, Math.ceil(30 / titles.length));
    const strip: TitleSummary[] = [];
    for (let r = 0; r < repeats; r++) strip.push(...shuffle(titles));
    const winIndex = strip.length - 3;
    strip[winIndex] = winnerPick;
    return { track: strip, winnerIndex: winIndex, winner: winnerPick };
  }, [titles, round]);

  // Phase "reset" : saute au départ SANS transition, puis (double rAF =
  // départ peint) arme la translation cible et passe en "spinning".
  useEffect(() => {
    if (phase !== "reset" || track.length === 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const cw = viewport.clientWidth;
    setOffset(cw / 2 - CARD_W / 2);
    let disposed = false;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (disposed) return;
        setOffset(cw / 2 - (winnerIndex * STEP + CARD_W / 2));
        setPhase("spinning");
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [phase, round, track, winnerIndex]);

  // Phase "spinning" : fin du spin après la durée + petit délai.
  useEffect(() => {
    if (phase !== "spinning") return;
    const done = window.setTimeout(() => setPhase("done"), SPIN_MS + 250);
    return () => window.clearTimeout(done);
  }, [phase]);

    const yooooRef = useRef<HTMLAudioElement | null>(null);
  const stopYoooo = () => {
    if (yooooRef.current) {
      yooooRef.current.pause();
      yooooRef.current.currentTime = 0;
      yooooRef.current = null;
    }
  };

  // YOOOOOO : le cri démarre AVEC le spin. Le fichier fait 10 s et le
  // spin 8 s : le cri monte pendant la décélération et se termine ~2 s
  // après la révélation — timing comique naturel. Stoppé proprement si
  // « Rejouer » ou fermeture avant la fin.
  useEffect(() => {
    if (phase !== "spinning" || sound !== "yoooo") return;
    stopYoooo();
    const audio = new Audio("sounds/yoooo.mp3");
    audio.volume = 0.9;
    yooooRef.current = audio;
    // Fichier absent (404) ou bloqué : silence, jamais d'erreur visible.
    audio.play().catch(() => {});
  }, [phase, round, sound]);

  // Tic-tic décélérant pendant le spin (mode moderne uniquement — le cri
  // remplace tout en mode yoooo).
  useEffect(() => {
    if (phase !== "spinning" || sound !== "modern") return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") void ctx.resume();
    let interval = 70;
    let stopped = false;
    let timer = 0;
    const tick = () => {
      if (stopped) return;
      playTick(ctx);
      interval = Math.min(interval * 1.13, 450);
      timer = window.setTimeout(tick, interval);
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [phase, sound]);

  // Révélation sonore : carillon doux (mode moderne uniquement).
  useEffect(() => {
    if (phase !== "done" || sound !== "modern" || !audioCtxRef.current) return;
    playChime(audioCtxRef.current);
  }, [phase, sound]);

  // Fermeture de la roulette : stoppe le cri + ferme le contexte audio.
  useEffect(() => {
    return () => {
      stopYoooo();
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []);

  const changeSound = (value: RouletteSound) => {
    setSound(value);
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, value);
    } catch {
      // stockage indisponible : choix non mémorisé, sans gravité
    }
  };

    const replay = () => {
    stopYoooo();
    setPhase("reset");
    setRound((r) => r + 1);
  };

  return (
    <div className="avm-roulette">
      <div className="avm-roulette__header">
        <h2>🎰 Roulette — {categoryName}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            className="avm-roulette__sound"
            value={sound}
            onChange={(event) => changeSound(event.target.value as RouletteSound)}
            aria-label="Son de la roulette"
          >
            <option value="off">Muet</option>
            <option value="modern">Moderne</option>
            <option value="yoooo">YOOOOOO</option>
          </select>
          <IconButton label="Fermer la roulette" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </div>
      <div className="avm-roulette__viewport" ref={viewportRef}>
        <div
          className="avm-roulette__track"
          style={{
            transform: `translateX(${offset}px)`,
            transition:
              phase === "spinning"
                ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.15, 1)`
                : "none",
          }}
        >
          {track.map((title, index) => (
            <div
              key={`${title.id}-${index}`}
              className={
                "avm-roulette__card" +
                (phase === "done" && index === winnerIndex ? " avm-roulette__card--winner" : "")
              }
            >
              {assetUrl(title.poster) ? (
                <img src={assetUrl(title.poster)} alt="" />
              ) : (
                <div className="avm-card__placeholder" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
        <div className="avm-roulette__marker" aria-hidden="true" />
      </div>
      <div className="avm-roulette__footer">
        {phase === "spinning" || phase === "reset" ? (
          <p className="avm-settings-muted">Le destin choisit…</p>
        ) : winner ? (
          <>
            <p className="avm-roulette__winner-name">
              {winner.name}
              {winner.year ? ` (${winner.year})` : ""}
            </p>
            <div className="avm-roulette__actions">
              <Button variant="primary" onClick={() => onPlay(winner)}>
                <Play size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                Lecture
              </Button>
              <Button variant="secondary" onClick={replay}>
                <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                Rejouer
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}