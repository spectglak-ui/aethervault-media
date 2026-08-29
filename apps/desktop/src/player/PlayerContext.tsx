import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type {
  PlayableMedia,
  PlaybackQueueState,
  PlayerSettingsChangedPayload,
  PlayerStateEvent,
} from "@aethervault/shared-types";
import { playerApi } from "../features/player/api";
import { titleApi } from "../features/title/api";
import { windowApi } from "../features/window/api";
import { playerSettingsApi } from "../features/playerSettings/api";
import { getWindowLabel } from "../window/getWindowLabel";

interface PlayerContextValue {
  currentMedia: PlayableMedia | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  rate: number;
  isFullscreen: boolean;
  displayMode: "contain" | "cover" | "stretch" | "original";
  setDisplayMode: (mode: "contain" | "cover" | "stretch" | "original") => void;
  isDetached: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  lastError: string | null;
  dismissError: () => void;
  loopEnabled: boolean;
  toggleLoop: () => void;
  autoNextEnabled: boolean;
  toggleAutoNext: () => void;
  play: (media: PlayableMedia) => void;
  playQueue: (items: PlayableMedia[], startIndex: number) => void;
  playNext: () => void;
  playPrevious: () => void;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  setVolumeLevel: (value: number) => void;
  toggleMuted: () => void;
  setRate: (value: number) => void;
  toggleFullscreen: () => void;
  toggleDetached: () => void;
  stop: () => void;
  captureScreenshot: () => Promise<string | null>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PROGRESS_SAVE_INTERVAL_MS = 5000;
const MIN_RESUMABLE_SECONDS = 5;
const PREVIOUS_RESTART_THRESHOLD_SECONDS = 3;
const EMPTY_QUEUE: PlaybackQueueState = { items: [], currentIndex: null };

export const FULLSCREEN_TARGET_ID = "avm-player-fullscreen-root";

function loadAndBroadcast(items: PlayableMedia[], index: number): void {
  const media = items[index];
  void emit("player-queue-changed", { items, currentIndex: index } satisfies PlaybackQueueState);
  const getProgress = media.isPrivate ? playerApi.getPrivateProgress : playerApi.getProgress;
  getProgress(media.id)
    .then((progress) => {
      void playerApi.load(media.path).then(() => {
        if (progress && progress.position_seconds > MIN_RESUMABLE_SECONDS) {
          void playerApi.seek(progress.position_seconds);
        }
      });
    })
    .catch(() => {
      void playerApi.load(media.path);
    });
}

function syncFullscreen(shouldBeFullscreen: boolean): void {
  if (typeof document === "undefined") return;
  if (shouldBeFullscreen) {
    if (document.fullscreenElement) return;
    const target = document.getElementById(FULLSCREEN_TARGET_ID);
    target?.requestFullscreen().catch(() => {});
    return;
  }
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PlaybackQueueState>(EMPTY_QUEUE);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRateState] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [displayMode, setDisplayMode] = useState<"contain" | "cover" | "stretch" | "original">("contain");
  const [isDetached, setIsDetached] = useState(() => getWindowLabel() === "player");
  const [lastError, setLastError] = useState<string | null>(null);

  const [loopEnabled, setLoopEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("avm-player-loop") === "1";
    } catch {
      return false;
    }
  });
  const [autoNextEnabled, setAutoNextEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("avm-player-autonext") !== "0";
    } catch {
      return true;
    }
  });
  const loopRef = useRef(loopEnabled);
  loopRef.current = loopEnabled;
  const autoNextRef = useRef(autoNextEnabled);
  autoNextRef.current = autoNextEnabled;

  const currentMedia = queue.currentIndex !== null ? queue.items[queue.currentIndex] ?? null : null;

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const currentMediaRef = useRef<PlayableMedia | null>(null);
  currentMediaRef.current = currentMedia;
  const positionRef = useRef(0);
  positionRef.current = position;
  const durationRef = useRef(0);
  durationRef.current = duration;

  const seekDebounceRef = useRef<number | null>(null);
  const volumeDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    playerSettingsApi
      .get()
      .then((saved) => {
        if (!saved) return;
        setVolume(saved.volume);
        setMuted(saved.muted);
        setRateState(saved.rate);
        void playerApi.setVolume(saved.volume);
        void playerApi.setMuted(saved.muted);
        void playerApi.setRate(saved.rate);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unlistenState = listen<PlayerStateEvent>("player-state", (event) => {
      const { position_seconds, duration_seconds, playing, ended, error } = event.payload;
      if (position_seconds !== undefined && position_seconds !== null) {
        setPosition(position_seconds);
      }
      if (duration_seconds !== undefined && duration_seconds !== null) {
        setDuration(duration_seconds);
      }
      if (playing !== undefined && playing !== null) {
        setIsPlaying(playing);
      }
      if (error) {
        setLastError(`Lecture impossible : ${error}`);
      }
      if (ended) {
        // Étape 8 : enregistre la session dans watch_history si ≥ 30 s vus
        if (currentMediaRef.current && positionRef.current >= 30 && durationRef.current > 0) {
          void titleApi
            .recordWatch(currentMediaRef.current.id, positionRef.current, durationRef.current)
            .catch(() => {});
        }
        if (loopRef.current && currentMediaRef.current) {
          console.info("[Boucle] Fin de fichier — rechargement du média.");
          setPosition(0);
          void playerApi.load(currentMediaRef.current.path);
        } else if (autoNextRef.current) {
          const { items, currentIndex } = queueRef.current;
          if (currentIndex !== null && currentIndex < items.length - 1) {
            loadAndBroadcast(items, currentIndex + 1);
          }
        }
      }
    });

    let lastMediaId: number | null = null;
    const unlistenQueue = listen<PlaybackQueueState>("player-queue-changed", (event) => {
      const state = event.payload;
      const media = state.currentIndex !== null ? state.items[state.currentIndex] ?? null : null;
      const mediaChanged = (media?.id ?? null) !== lastMediaId;
      lastMediaId = media?.id ?? null;
      setQueue(state);
      if (mediaChanged) {
        setIsPlaying(media !== null);
        setPosition(0);
        setDuration(0);
        if (media === null) {
          syncFullscreen(false);
        }
      }
      setLastError(null);
    });

    const unlistenSettings = listen<PlayerSettingsChangedPayload>(
      "player-settings-changed",
      (event) => {
        setVolume(event.payload.volume);
        setMuted(event.payload.muted);
        setRateState(event.payload.rate);
      }
    );

    const unlistenExtras = listen<{ loop: boolean; autoNext: boolean }>(
      "player-extras-changed",
      (event) => {
        setLoopEnabled(event.payload.loop);
        setAutoNextEnabled(event.payload.autoNext);
      }
    );

    const unlistenClosed = listen("player-window-closed", () => {
      setIsDetached(false);
    });

    return () => {
      void unlistenState.then((fn) => fn());
      void unlistenQueue.then((fn) => fn());
      void unlistenSettings.then((fn) => fn());
      void unlistenExtras.then((fn) => fn());
      void unlistenClosed.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const target = document.getElementById(FULLSCREEN_TARGET_ID);
      setIsFullscreen(document.fullscreenElement === target);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const saveProgressNow = () => {
    const media = currentMediaRef.current;
    if (media && durationRef.current > 0) {
      const saveProgress = media.isPrivate ? playerApi.savePrivateProgress : playerApi.saveProgress;
      saveProgress(media.id, positionRef.current, durationRef.current).catch(() => {});
    }
  };

  useEffect(() => {
    if (!currentMedia || !isPlaying) return;
    const interval = window.setInterval(saveProgressNow, PROGRESS_SAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [currentMedia, isPlaying]);

  const hasNext = queue.currentIndex !== null && queue.currentIndex < queue.items.length - 1;
  const hasPrevious = queue.currentIndex !== null && queue.currentIndex > 0;

  const value = useMemo<PlayerContextValue>(
    () => ({
      currentMedia,
      isPlaying,
      position,
      duration,
      volume,
      muted,
      rate,
      isFullscreen,
      displayMode,
      setDisplayMode,
      isDetached,
      hasNext,
      hasPrevious,
      lastError,
      dismissError: () => setLastError(null),
      loopEnabled,
      autoNextEnabled,
      play: (media) => loadAndBroadcast([media], 0),
      playQueue: (items, startIndex) => {
        if (items.length === 0) return;
        const clampedIndex = Math.min(Math.max(startIndex, 0), items.length - 1);
        loadAndBroadcast(items, clampedIndex);
      },
      playNext: () => {
        const { items, currentIndex } = queueRef.current;
        if (currentIndex === null || currentIndex >= items.length - 1) return;
        loadAndBroadcast(items, currentIndex + 1);
      },
      playPrevious: () => {
        const { items, currentIndex } = queueRef.current;
        if (currentIndex === null) return;
        if (positionRef.current > PREVIOUS_RESTART_THRESHOLD_SECONDS || currentIndex === 0) {
          setPosition(0);
          void playerApi.seek(0);
          return;
        }
        loadAndBroadcast(items, currentIndex - 1);
      },
      togglePlay: () => {
        const next = !isPlaying;
        setIsPlaying(next);
        void playerApi.setPaused(!next);
      },
      seek: (seconds) => {
        setPosition(seconds);
        if (seekDebounceRef.current !== null) {
          window.clearTimeout(seekDebounceRef.current);
        }
        seekDebounceRef.current = window.setTimeout(() => {
          void playerApi.seek(seconds);
        }, 150);
      },
      setVolumeLevel: (level) => {
        setVolume(level);
        if (volumeDebounceRef.current !== null) {
          window.clearTimeout(volumeDebounceRef.current);
        }
        volumeDebounceRef.current = window.setTimeout(() => {
          void playerApi.setVolume(level);
          const next = { volume: level, muted, rate };
          void emit("player-settings-changed", next);
          void playerSettingsApi.save(next);
        }, 150);
      },
      toggleMuted: () => {
        const muteNext = !muted;
        setMuted(muteNext);
        void playerApi.setMuted(muteNext);
        const next = { volume, muted: muteNext, rate };
        void emit("player-settings-changed", next);
        void playerSettingsApi.save(next);
      },
      setRate: (value) => {
        setRateState(value);
        void playerApi.setRate(value);
        const next = { volume, muted, rate: value };
        void emit("player-settings-changed", next);
        void playerSettingsApi.save(next);
      },
      toggleLoop: () => {
        const next = !loopEnabled;
        setLoopEnabled(next);
        try {
          localStorage.setItem("avm-player-loop", next ? "1" : "0");
        } catch {}
        void emit("player-extras-changed", { loop: next, autoNext: autoNextEnabled });
      },
      toggleAutoNext: () => {
        const next = !autoNextEnabled;
        setAutoNextEnabled(next);
        try {
          localStorage.setItem("avm-player-autonext", next ? "1" : "0");
        } catch {}
        void emit("player-extras-changed", { loop: loopEnabled, autoNext: next });
      },
      toggleFullscreen: () => syncFullscreen(!isFullscreen),
      toggleDetached: () => {
        if (isDetached) {
          console.info("[PiP] Fermeture demandée.");
          windowApi
            .closePlayerWindow()
            .then(() => {
              console.info("[PiP] Fenêtre fermée avec succès.");
              setIsDetached(false);
            })
            .catch((err) => {
              console.error("[PiP] Échec de la fermeture de la fenêtre PiP.", err);
              setLastError("Impossible de fermer la fenêtre Picture-in-Picture.");
            });
          return;
        }
        console.info("[PiP] Ouverture demandée.");
        windowApi
          .openPlayerWindow()
          .then(() => {
            console.info("[PiP] Fenêtre ouverte avec succès.");
            setIsDetached(true);
          })
          .catch((err) => {
            console.error("[PiP] Échec de l'ouverture de la fenêtre PiP.", err);
            setLastError("Impossible d'ouvrir le mode Picture-in-Picture. Réessayez.");
          });
      },
      stop: () => {
        void playerApi.stop();
        windowApi
          .closePlayerWindow()
          .catch((err) => console.error("[PiP] Échec de la fermeture (stop()).", err));
        setIsDetached(false);
        void emit("player-queue-changed", EMPTY_QUEUE satisfies PlaybackQueueState);
      },
      captureScreenshot: () => playerApi.captureScreenshot().catch(() => null),
    }),
    [
      currentMedia,
      isPlaying,
      position,
      duration,
      volume,
      muted,
      rate,
      isFullscreen,
      displayMode,
      isDetached,
      hasNext,
      hasPrevious,
      lastError,
      loopEnabled,
      autoNextEnabled,
    ]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayer doit être utilisé à l'intérieur de <PlayerProvider>");
  }
  return ctx;
}