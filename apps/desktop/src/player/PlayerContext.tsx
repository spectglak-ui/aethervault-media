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
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { friendsApi } from "../features/friends/api";
import { getWindowLabel } from "../window/getWindowLabel";
import { applyNearMax } from "../window/nearMax";

interface PlayerContextValue {
  currentMedia: PlayableMedia | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  buffered: number;
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
  shuffleEnabled: boolean;
  toggleShuffle: () => void;
  queueNext: (index: number) => void;
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
  queue: PlaybackQueueState;
  immersiveMode: "audio" | "video" | null;
  immersiveOpen: boolean;
  openImmersive: () => void;
  closeAudioView: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PROGRESS_SAVE_INTERVAL_MS = 5000;
const MIN_RESUMABLE_SECONDS = 5;
const PREVIOUS_RESTART_THRESHOLD_SECONDS = 3;
const EMPTY_QUEUE: PlaybackQueueState = { items: [], currentIndex: null };

export const FULLSCREEN_TARGET_ID = "avm-player-fullscreen-root";

function loadAndBroadcast(items: PlayableMedia[], index: number): void {
  const media = items[index];
  void emit("player-queue-changed", {
    items,
    currentIndex: index,
  } satisfies PlaybackQueueState);
  const getProgress = media.isPrivate
    ? playerApi.getPrivateProgress
    : playerApi.getProgress;
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
  const win = getCurrentWindow();
  if (shouldBeFullscreen) {
    if (document.fullscreenElement) return;
    void win.setAlwaysOnTop(true);
    const target = document.getElementById(FULLSCREEN_TARGET_ID);
    target?.requestFullscreen().catch(() => {});
    return;
  }
  const settle = () => {
    void win.setAlwaysOnTop(false);
    void applyNearMax();
  };
  if (document.fullscreenElement) {
    document.exitFullscreen().then(settle).catch(settle);
    return;
  }
  settle();
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PlaybackQueueState>(EMPTY_QUEUE);
  const [isPlaying, setIsPlaying] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRateState] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [displayMode, setDisplayMode] = useState<
    "contain" | "cover" | "stretch" | "original"
  >("contain");
  const [isDetached, setIsDetached] = useState(() => getWindowLabel() === "player");
  const [lastError, setLastError] = useState<string | null>(null);
  const [immersiveOpen, setImmersiveOpen] = useState(false);

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
  const [shuffleEnabled, setShuffleEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("avm-player-shuffle") === "1";
    } catch {
      return false;
    }
  });

  const loopRef = useRef(loopEnabled);
  loopRef.current = loopEnabled;
  const autoNextRef = useRef(autoNextEnabled);
  autoNextRef.current = autoNextEnabled;
  const shuffleRef = useRef(shuffleEnabled);
  shuffleRef.current = shuffleEnabled;

  // CORRECTIF (lecture automatique — mauvais épisode/film) : la fenêtre
  // "player" (PiP, aujourd'hui masquée côté frontend mais toujours
  // PRÉ-CRÉÉE et active — voir commands::window::open_player_window)
  // monte, elle aussi, un <PlayerProvider> complet et reçoit les MÊMES
  // événements globaux ("player-state", "player-queue-changed") que la
  // fenêtre "main", puisque `emit`/`app_handle.emit(...)` diffusent à
  // toutes les fenêtres. Sans ce garde-fou, les DEUX fenêtres réagissent
  // chacune de leur côté à un même événement de fin de lecture et
  // décident, indépendamment, du média suivant (deux tirages aléatoires
  // différents en mode Aléatoire, ou deux appels `player_load`
  // concurrents en mode séquentiel) — c'est la cause du bug "épisode/
  // film suivant aléatoire". Seule la fenêtre "main" reste autorisée à
  // piloter l'avance automatique et la sauvegarde périodique de
  // progression ; la fenêtre "player" continue de simplement refléter
  // l'état reçu (elle garde ses boutons Suivant/Précédent manuels, qui
  // restent des actions utilisateur ponctuelles et ne posent pas ce
  // problème de duplication).
  const isPipWindow = useRef(getWindowLabel() === "player").current;

  const currentMedia =
    queue.currentIndex !== null ? queue.items[queue.currentIndex] ?? null : null;

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const currentMediaRef = useRef<PlayableMedia | null>(null);
  currentMediaRef.current = currentMedia;
  const positionRef = useRef(0);
  positionRef.current = position;
  const durationRef = useRef(0);
  durationRef.current = duration;
  const endedHandledRef = useRef<number | null>(null);
  // CORRECTIF (mineur, lié) : distingue une pause VOLONTAIRE (utilisateur)
  // du repli heuristique de fin de lecture ci-dessous — sans cela, une
  // pause manuelle dans la dernière seconde d'un média déclenchait un
  // enchaînement automatique non désiré vers le média suivant.
  const userPausedRef = useRef(false);

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

  const handleEnded = () => {
    // Seule la fenêtre "main" décide de l'avance automatique — voir le
    // commentaire sur `isPipWindow` plus haut.
    if (isPipWindow) return;
    const media = currentMediaRef.current;
    if (!media || endedHandledRef.current === media.id) return;
    endedHandledRef.current = media.id;
    if (positionRef.current >= 30 && durationRef.current > 0) {
      void titleApi
        .recordWatch(media.id, positionRef.current, durationRef.current)
        .catch(() => {});
    }
    if (loopRef.current) {
      setPosition(0);
      endedHandledRef.current = null;
      void playerApi.load(media.path);
    } else if (autoNextRef.current) {
      const { items, currentIndex } = queueRef.current;
      if (currentIndex !== null && items.length > 0) {
        let nextIndex: number | null = null;
        if (shuffleRef.current && items.length > 1) {
          do {
            nextIndex = Math.floor(Math.random() * items.length);
          } while (nextIndex === currentIndex);
        } else if (currentIndex < items.length - 1) {
          nextIndex = currentIndex + 1;
        }
        if (nextIndex !== null) loadAndBroadcast(items, nextIndex);
      }
    }
  };

  /** 0.4.0 : publie l'activité de visionnage (amis) — même rythme que la
   * sauvegarde de progression (5 s), jamais de spam SQLite. */
  const publishActivity = () => {
    const media = currentMediaRef.current;
    if (!media || durationRef.current <= 0) return;
    const extra = media as {
      titleId?: number;
      poster?: string;
      categoryKey?: string;
    };
    friendsApi
      .updateActivity({
        title_id: extra.titleId ?? null,
        title_name: media.title ?? null,
        poster: extra.poster ?? null,
        category_key: extra.categoryKey ?? null,
        position_seconds: positionRef.current,
        duration_seconds: durationRef.current,
      })
      .catch(() => {});
  };

  const saveProgressNow = () => {
    const media = currentMediaRef.current;
    if (media && durationRef.current > 0) {
      const saveProgress = media.isPrivate
        ? playerApi.savePrivateProgress
        : playerApi.saveProgress;
      saveProgress(media.id, positionRef.current, durationRef.current).catch(() => {});
      publishActivity();
    }
  };

  useEffect(() => {
    const unlistenState = listen<PlayerStateEvent>("player-state", (event) => {
      const bufferedSeconds = (event.payload as { buffered_seconds?: number })
        .buffered_seconds;
      if (typeof bufferedSeconds === "number") setBuffered(bufferedSeconds);
      const { position_seconds, duration_seconds, playing, ended, error } =
        event.payload;
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
        handleEnded();
      } else if (
        !userPausedRef.current &&
        playing === false &&
        durationRef.current > 0 &&
        positionRef.current >= durationRef.current - 1
      ) {
        // Repli : certains flux ne renvoient jamais `ended: true` — mais
        // on ignore ce repli si la pause vient d'un clic utilisateur
        // (voir `userPausedRef`), pour ne pas enchaîner sur le média
        // suivant quand l'utilisateur met simplement en pause dans la
        // dernière seconde.
        handleEnded();
      }
    });

    let lastMediaId: number | null = null;
    const unlistenQueue = listen<PlaybackQueueState>("player-queue-changed", (event) => {
      const state = event.payload;
      const media =
        state.currentIndex !== null ? state.items[state.currentIndex] ?? null : null;
      const mediaChanged = (media?.id ?? null) !== lastMediaId;
      lastMediaId = media?.id ?? null;
      setQueue(state);
      if (mediaChanged) {
        setIsPlaying(media !== null);
        setPosition(0);
        setDuration(0);
        setBuffered(0);
        endedHandledRef.current = null;
        userPausedRef.current = false;
        if (media?.mode) setImmersiveOpen(true);
        if (media === null) {
          setImmersiveOpen(false);
          syncFullscreen(false);
          // 0.4.0 : plus rien ne joue → activité amis effacée.
          friendsApi.clearActivity().catch(() => {});
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
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    // Idem : évite d'écrire la progression / l'activité amis en double
    // (une fois par fenêtre) à chaque tick de 5 s.
    if (isPipWindow) return;
    if (!currentMedia || !isPlaying) return;
    const interval = window.setInterval(saveProgressNow, PROGRESS_SAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [currentMedia, isPlaying]);

  const hasNext = queue.currentIndex !== null && queue.currentIndex < queue.items.length - 1;
  const hasPrevious = queue.currentIndex !== null && queue.currentIndex > 0;

  const immersiveMode: "audio" | "video" | null = currentMedia?.mode ?? null;

  const value = useMemo<PlayerContextValue>(
    () => ({
      currentMedia,
      isPlaying,
      position,
      duration,
      buffered,
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
      shuffleEnabled,
      play: (media) => loadAndBroadcast([media], 0),
      playQueue: (items, startIndex) => {
        if (items.length === 0) return;
        const clampedIndex = Math.min(Math.max(startIndex, 0), items.length - 1);
        loadAndBroadcast(items, clampedIndex);
      },
      playNext: () => {
        const { items, currentIndex } = queueRef.current;
        if (currentIndex === null || items.length === 0) return;
        if (shuffleRef.current && items.length > 1) {
          let n = currentIndex;
          while (n === currentIndex) {
            n = Math.floor(Math.random() * items.length);
          }
          loadAndBroadcast(items, n);
          return;
        }
        if (currentIndex >= items.length - 1) return;
        loadAndBroadcast(items, currentIndex + 1);
      },
      playPrevious: () => {
        const { items, currentIndex } = queueRef.current;
        if (currentIndex === null) return;
        if (
          positionRef.current > PREVIOUS_RESTART_THRESHOLD_SECONDS ||
          currentIndex === 0
        ) {
          setPosition(0);
          void playerApi.seek(0);
          return;
        }
        loadAndBroadcast(items, currentIndex - 1);
      },
      togglePlay: () => {
        const next = !isPlaying;
        userPausedRef.current = !next;
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
      toggleShuffle: () => {
        const next = !shuffleEnabled;
        setShuffleEnabled(next);
        try {
          localStorage.setItem("avm-player-shuffle", next ? "1" : "0");
        } catch {}
      },
      queueNext: (index: number) => {
        const { items, currentIndex } = queueRef.current;
        if (currentIndex === null) return;
        if (index === currentIndex || index < 0 || index >= items.length) return;
        const newItems = [...items];
        const [moved] = newItems.splice(index, 1);
        const currentPos = index < currentIndex ? currentIndex - 1 : currentIndex;
        newItems.splice(currentPos + 1, 0, moved);
        void emit("player-queue-changed", {
          items: newItems,
          currentIndex: currentPos,
        } satisfies PlaybackQueueState);
      },
      toggleFullscreen: () => syncFullscreen(!isFullscreen),
      toggleDetached: () => {
        if (isDetached) {
          windowApi
            .closePlayerWindow()
            .then(() => setIsDetached(false))
            .catch((err) => {
              console.error("[PiP] Échec de la fermeture PiP.", err);
              setLastError("Impossible de fermer la fenêtre PiP.");
            });
          return;
        }
        windowApi
          .openPlayerWindow()
          .then(() => setIsDetached(true))
          .catch((err) => {
            console.error("[PiP] Échec de l'ouverture PiP.", err);
            setLastError("Impossible d'ouvrir le mode PiP.");
          });
      },
      stop: () => {
        const media = currentMediaRef.current;
        if (
          media &&
          endedHandledRef.current !== media.id &&
          durationRef.current > 0 &&
          positionRef.current >= 30
        ) {
          void titleApi
            .recordWatch(media.id, positionRef.current, durationRef.current)
            .catch(() => {});
        }
        endedHandledRef.current = null;
        void playerApi.stop();
        // 0.4.0 : arrêt → activité amis effacée.
        friendsApi.clearActivity().catch(() => {});
        windowApi
          .closePlayerWindow()
          .catch((err) => console.error("[PiP] Échec de la fermeture (stop()).", err));
        setIsDetached(false);
        setImmersiveOpen(false);
        void emit("player-queue-changed", EMPTY_QUEUE satisfies PlaybackQueueState);
      },
      captureScreenshot: () => playerApi.captureScreenshot().catch(() => null),
      queue,
      immersiveMode,
      immersiveOpen,
      openImmersive: () => setImmersiveOpen(true),
      closeAudioView: () => setImmersiveOpen(false),
    }),
    [
      currentMedia,
      isPlaying,
      position,
      duration,
      buffered,
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
      shuffleEnabled,
      queue,
      immersiveMode,
      immersiveOpen,
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