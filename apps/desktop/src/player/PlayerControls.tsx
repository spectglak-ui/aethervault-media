import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  AudioLines,
  Captions,
  Maximize2,
  Minimize2,
  Crop,
  X,
  Camera,
  Sparkles,
  Volume2,
  VolumeX,
  Pin,
} from "lucide-react";
import { Menu, CheckMenuItem } from "@tauri-apps/api/menu";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { IconButton, Slider } from "@aethervault/ui-kit";
import type { PlayerTrack } from "@aethervault/shared-types";
import { usePlayer } from "./PlayerContext";
import { playerApi } from "../features/player/api";
import { windowApi } from "../features/window/api";
import { formatTime } from "./formatTime";

interface PlayerControlsProps {
  variant: "normal" | "detached";
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const SHADER_LABELS: Record<string, string> = {
  off: "Désactivé",
  sharp: "Netteté",
  vivid: "Couleurs vives",
  anime: "Anime4K-lite",
};

const DISPLAY_MODE_LABELS: Record<"contain" | "cover" | "stretch" | "original", string> = {
  contain: "Ajuster",
  cover: "Remplir",
  stretch: "Étirer",
  original: "Taille originale",
};

function trackLabel(track: PlayerTrack, index: number): string {
  if (track.title && track.lang) {
    return `${track.title} (${track.lang})`;
  }
  return track.title ?? track.lang ?? `Piste ${index + 1}`;
}

export function PlayerControls({ variant }: PlayerControlsProps) {
  const {
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
    dismissError,
    togglePlay,
    seek,
    setVolumeLevel,
    toggleMuted,
    setRate,
    toggleFullscreen,
    toggleDetached,
    stop,
    captureScreenshot,
    playNext,
    playPrevious,
  } = usePlayer();

  const [screenshotFeedback, setScreenshotFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!screenshotFeedback) return;
    const timeout = window.setTimeout(() => setScreenshotFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [screenshotFeedback]);

  /** Mode flottant actif (fenêtre sans bordure, toujours au-dessus) —
   * signalé par le Rust via l'événement `floating-changed`. */
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<boolean>("floating-changed", (event) => setFloating(event.payload)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  if (!currentMedia) {
    return null;
  }

  /** Redimensionnement natif via la commande interne du plugin window —
   * les chaînes correspondent exactement aux variantes de l'enum Rust
   * (`North`, `SouthEast`...). */
  const startResize = (direction: string) => {
    void invoke("plugin:window|start_resize_dragging", { direction });
  };

  const edge: CSSProperties = { position: "absolute", pointerEvents: "auto" };

  const handleCaptureScreenshot = async () => {
    const path = await captureScreenshot();
    if (path) {
      setScreenshotFeedback({ kind: "success", message: `Capture enregistrée : ${path}` });
    } else {
      setScreenshotFeedback({
        kind: "error",
        message: "Échec de la capture d'écran — réessayez.",
      });
    }
  };

  const openAudioMenu = async () => {
    try {
      const { audio } = await playerApi.listTracks();
      if (audio.length === 0) return;
      const items = await Promise.all(
        audio.map((track, index) =>
          CheckMenuItem.new({
            text: trackLabel(track, index),
            checked: track.selected,
            action: () => void playerApi.setAudioTrack(track.id),
          })
        )
      );
      const menu = await Menu.new({ items });
      await menu.popup();
    } catch {
      // best-effort
    }
  };

  const openSubtitleMenu = async () => {
    try {
      const { subtitles } = await playerApi.listTracks();
      const noneItem = await CheckMenuItem.new({
        text: "Aucun",
        checked: !subtitles.some((track) => track.selected),
        action: () => void playerApi.setSubtitleTrack(null),
      });
      const trackItems = await Promise.all(
        subtitles.map((track, index) =>
          CheckMenuItem.new({
            text: trackLabel(track, index),
            checked: track.selected,
            action: () => void playerApi.setSubtitleTrack(track.id),
          })
        )
      );
      const menu = await Menu.new({ items: [noneItem, ...trackItems] });
      await menu.popup();
    } catch {
      // best-effort
    }
  };

  const openDisplayModeMenu = async () => {
    try {
      const modes: (typeof displayMode)[] = ["contain", "cover", "stretch", "original"];
      const items = await Promise.all(
        modes.map((mode) =>
          CheckMenuItem.new({
            text: DISPLAY_MODE_LABELS[mode],
            checked: displayMode === mode,
            action: () => setDisplayMode(mode),
          })
        )
      );
      const menu = await Menu.new({ items });
      await menu.popup();
    } catch {
      // best-effort
    }
  };
  
    const openShaderMenu = async () => {
    try {
      const current = await playerApi.getPostShader();
      const items = await Promise.all(
        Object.entries(SHADER_LABELS).map(([id, label]) =>
          CheckMenuItem.new({
            text: label,
            checked: current === id,
            action: () => void playerApi.setPostShader(id),
          })
        )
      );
      const menu = await Menu.new({ items });
      await menu.popup();
    } catch {
      // best-effort
    }
  };

  return (
    <div className="avm-player__controls">
      {variant === "normal" && (
        <div
          className="avm-player__title"
          {...(floating ? { "data-tauri-drag-region": "" } : {})}
          style={floating ? { cursor: "move" } : undefined}
        >
          {currentMedia.title}
        </div>
      )}
      {lastError && (
        <div className="avm-player__error" role="alert">
          <span>{lastError}</span>
          <IconButton label="Fermer ce message" onClick={dismissError}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {screenshotFeedback && (
        <div
          className={
            screenshotFeedback.kind === "success"
              ? "avm-player__error avm-player__error--success"
              : "avm-player__error"
          }
          role="status"
        >
          <span>{screenshotFeedback.message}</span>
          <IconButton label="Fermer ce message" onClick={() => setScreenshotFeedback(null)}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      <div className="avm-player__row">
        {variant === "normal" && (
          <IconButton label="Piste précédente" onClick={playPrevious} disabled={!hasPrevious}>
            <SkipBack size={16} />
          </IconButton>
        )}
        <IconButton label={isPlaying ? "Pause" : "Lecture"} onClick={togglePlay}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </IconButton>
        {variant === "detached" && (
          <IconButton label="Retour à la fenêtre principale" onClick={toggleDetached}>
            <Minimize2 size={16} />
          </IconButton>
        )}
        {variant === "normal" && (
          <IconButton label="Piste suivante" onClick={playNext} disabled={!hasNext}>
            <SkipForward size={16} />
          </IconButton>
        )}
        <span className="avm-player__time">{formatTime(position)}</span>
        <Slider
          value={position}
          max={duration || 1}
          step={0.5}
          onChange={seek}
          ariaLabel="Progression de la lecture"
        />
        <span className="avm-player__time">{formatTime(duration)}</span>
        {variant === "normal" && (
          <>
            <IconButton label={muted ? "Réactiver le son" : "Couper le son"} onClick={toggleMuted}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </IconButton>
            <div className="avm-player__volume">
              <Slider
                value={muted ? 0 : volume}
                max={1}
                step={0.05}
                onChange={setVolumeLevel}
                ariaLabel="Volume"
              />
            </div>
            <IconButton label="Piste audio" onClick={() => void openAudioMenu()}>
              <AudioLines size={16} />
            </IconButton>
            <IconButton label="Sous-titres" onClick={() => void openSubtitleMenu()}>
              <Captions size={16} />
            </IconButton>
          </>
        )}
        {variant === "normal" && (
          <select
            className="avm-player__rate"
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
            aria-label="Vitesse de lecture"
          >
            {PLAYBACK_RATES.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        )}
        {variant === "normal" && (
          <IconButton
            label={`Mode d'affichage (${DISPLAY_MODE_LABELS[displayMode]})`}
            onClick={() => void openDisplayModeMenu()}
          >
            <Crop size={16} />
          </IconButton>
        )}
		        {variant === "normal" && (
          <IconButton
            label="Shader d'image (post-traitement)"
            onClick={() => void openShaderMenu()}
          >
            <Sparkles size={16} />
          </IconButton>
        )}
        {variant === "normal" && (
          <IconButton label="Capturer une image" onClick={() => void handleCaptureScreenshot()}>
            <Camera size={16} />
          </IconButton>
        )}
        {variant === "normal" && !isDetached && (
          <IconButton
            label="Mode flottant (toujours au-dessus, sans bordure)"
            onClick={() => void windowApi.toggleFloatingPlayer()}
          >
            <Pin size={16} />
          </IconButton>
        )}
        {/* ⚠️ PiP EN QUARANTAINE : le bouton "Détacher dans une fenêtre"
            (icône ExternalLink) est volontairement retiré de l'interface.
            Le code Rust correspondant (open_player_window, etc.) est
            conservé mais plus rien ne l'appelle. */}
        {variant === "normal" && !isDetached && (
          <IconButton
            label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </IconButton>
        )}
        <IconButton label="Fermer le lecteur" onClick={stop}>
          <X size={16} />
        </IconButton>
      </div>
      {floating && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          {/* Zone de déplacement en haut (remplace la barre de titre) */}
          <div
            data-tauri-drag-region=""
            style={{ ...edge, top: 0, left: 0, right: 0, height: 22, cursor: "move" }}
          />
          {/* Poignées de redimensionnement (bords + coins) */}
          <div onMouseDown={() => startResize("North")} style={{ ...edge, top: 0, left: 22, right: 22, height: 6, cursor: "ns-resize" }} />
          <div onMouseDown={() => startResize("South")} style={{ ...edge, bottom: 0, left: 22, right: 22, height: 6, cursor: "ns-resize" }} />
          <div onMouseDown={() => startResize("West")} style={{ ...edge, left: 0, top: 22, bottom: 22, width: 6, cursor: "ew-resize" }} />
          <div onMouseDown={() => startResize("East")} style={{ ...edge, right: 0, top: 22, bottom: 22, width: 6, cursor: "ew-resize" }} />
          <div onMouseDown={() => startResize("NorthWest")} style={{ ...edge, top: 0, left: 0, width: 12, height: 12, cursor: "nwse-resize" }} />
          <div onMouseDown={() => startResize("NorthEast")} style={{ ...edge, top: 0, right: 0, width: 12, height: 12, cursor: "nesw-resize" }} />
          <div onMouseDown={() => startResize("SouthWest")} style={{ ...edge, bottom: 0, left: 0, width: 12, height: 12, cursor: "nesw-resize" }} />
          <div onMouseDown={() => startResize("SouthEast")} style={{ ...edge, bottom: 0, right: 0, width: 12, height: 12, cursor: "nwse-resize" }} />
        </div>
      )}
    </div>
  );
}