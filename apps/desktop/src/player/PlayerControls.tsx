import { useEffect, useRef, useState } from "react";
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
  Volume2,
  VolumeX,
  Pin,
  Repeat1,
  ListVideo,
  Scissors,
  Wand2,
} from "lucide-react";
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
  /** 0.4.0 : comportement du bouton épinglette — "window" = flottant toute
   * la fenêtre (lecteur normal) ; "detach" = fenêtre de lecture détachée
   * (vue YouTube), pour ne pas embarquer toute la fenêtre. */
  floatMode?: "window" | "detach";
}

interface LocalTrackList {
  audio: PlayerTrack[];
  subtitles: PlayerTrack[];
}

interface SegmentInfo {
  episode_id: number;
  segment_type: string;
  start_seconds: number;
  end_seconds: number;
  source: string;
}

interface SegmentContext {
  episode_id: number | null;
  segments: SegmentInfo[];
}

const SEGMENT_LABELS: Record<string, string> = {
  intro: "Passer l'intro",
  outro: "Passer le générique",
  recap: "Passer le résumé",
};

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const DISPLAY_MODE_LABELS: Record<"contain" | "cover" | "stretch" | "original", string> = {
  contain: "Ajuster",
  cover: "Remplir",
  stretch: "Étirer",
  original: "Taille originale",
};

/** 0.4.0 : presets de post-traitement GPU (bouton restauré). */
const SHADER_PRESETS = ["off", "sharp", "vivid", "anime"] as const;
const SHADER_LABELS: Record<string, string> = {
  off: "Désactivé",
  sharp: "Netteté",
  vivid: "Couleurs vives",
  anime: "Anime",
};

const MENU_PANEL_STYLE: CSSProperties = {
  position: "fixed",
  bottom: 96,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 60,
  background: "var(--color-surface, #1b1b21)",
  border: "1px solid var(--color-border, #2c2c33)",
  borderRadius: 10,
  padding: 6,
  minWidth: 230,
  maxHeight: 280,
  overflowY: "auto",
  boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
};

function menuItemStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    width: "100%",
    padding: "6px 10px",
    border: "none",
    borderRadius: 6,
    background: active
      ? "color-mix(in srgb, var(--color-accent, #7c5cff) 18%, transparent)"
      : "none",
    color: active ? "var(--color-accent, #7c5cff)" : "var(--color-text, #f2f2f5)",
    cursor: "pointer",
    font: "inherit",
    textAlign: "left",
  };
}

function trackLabel(track: PlayerTrack, index: number): string {
  if (track.title && track.lang) {
    return `${track.title} (${track.lang})`;
  }
  return track.title ?? track.lang ?? `Piste ${index + 1}`;
}

export function PlayerControls({ variant, floatMode = "window" }: PlayerControlsProps) {
  const {
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
    dismissError,
    loopEnabled,
    autoNextEnabled,
    togglePlay,
    seek,
    setVolumeLevel,
    toggleMuted,
    setRate,
    toggleFullscreen,
    toggleDetached,
    toggleLoop,
    toggleAutoNext,
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

  const [floating, setFloating] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<boolean>("floating-changed", (event) => setFloating(event.payload)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const [openMenu, setOpenMenu] = useState<
    null | "audio" | "subtitles" | "display" | "segments" | "shader"
  >(null);
  const [tracks, setTracks] = useState<LocalTrackList>({ audio: [], subtitles: [] });
  const [shaderPreset, setShaderPreset] = useState<string>("off");

  // Garde le badge du bouton shaders synchronisé (changements externes).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("post-shader-changed", (event) => setShaderPreset(event.payload)).then(
      (fn) => {
        unlisten = fn;
      }
    );
    return () => unlisten?.();
  }, []);

  const toggleMenu = async (
    kind: "audio" | "subtitles" | "display" | "segments" | "shader"
  ) => {
    if (openMenu === kind) {
      setOpenMenu(null);
      return;
    }
    if (kind === "audio" || kind === "subtitles") {
      try {
        setTracks(await playerApi.listTracks());
      } catch {
        setTracks({ audio: [], subtitles: [] });
      }
    }
    if (kind === "shader") {
      try {
        setShaderPreset(await playerApi.getPostShader());
      } catch {
        setShaderPreset("off");
      }
    }
    setOpenMenu(kind);
  };

  // 0.3.0 : segments de saut (intro/outro/recap) du média courant.
  const [segmentCtx, setSegmentCtx] = useState<SegmentContext | null>(null);
  const [autoSkip, setAutoSkip] = useState(() => {
    try {
      return localStorage.getItem("avm-autoskip") === "1";
    } catch {
      return false;
    }
  });
  const [pendingMark, setPendingMark] = useState<{ type: string; start: number } | null>(null);
  const autoSkippedRef = useRef<string | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        setAutoSkip(localStorage.getItem("avm-autoskip") === "1");
      } catch {
        // best-effort
      }
    };
    window.addEventListener("avm-autoskip-changed", read);
    return () => window.removeEventListener("avm-autoskip-changed", read);
  }, []);

  useEffect(() => {
    if (!currentMedia) return;
    invoke<SegmentContext>("get_media_segment_context", { mediaFileId: currentMedia.id })
      .then(setSegmentCtx)
      .catch(() => setSegmentCtx(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMedia?.id]);

  const activeSegment =
    segmentCtx?.segments.find(
      (s) => position >= s.start_seconds && position < s.end_seconds - 1
    ) ?? null;

  // Auto-skip (désactivé par défaut) : saute silencieusement le segment.
  useEffect(() => {
    if (!autoSkip || !activeSegment) return;
    const key = `${activeSegment.segment_type}-${activeSegment.start_seconds}`;
    if (autoSkippedRef.current === key) return;
    autoSkippedRef.current = key;
    seek(activeSegment.end_seconds + 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSkip, activeSegment]);

  const reloadSegments = () => {
    if (!currentMedia) return;
    invoke<SegmentContext>("get_media_segment_context", { mediaFileId: currentMedia.id })
      .then(setSegmentCtx)
      .catch(() => {});
  };

  if (!currentMedia) {
    return null;
  }

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

  return (
    <div className="avm-player__controls">
      {/* 0.4.0 : titre draggable du PiP, police héritée. */}
      {variant === "detached" && (
        <div
          data-tauri-drag-region=""
          style={{
            cursor: "move",
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            color: "var(--color-text, #f2f2f5)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {currentMedia.title}
        </div>
      )}
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
      {/* 0.3.0 : bouton flottant « Passer » pendant un segment. */}
      {activeSegment && !autoSkip && (
        <button
          style={{
            position: "fixed",
            right: 24,
            bottom: 96,
            zIndex: 58,
            padding: "10px 18px",
            border: "1px solid var(--color-border, #2c2c33)",
            borderRadius: 8,
            background: "rgba(20,20,26,0.85)",
            color: "var(--color-text, #f2f2f5)",
            cursor: "pointer",
            font: "inherit",
            fontWeight: 600,
          }}
          onClick={() => seek(activeSegment.end_seconds + 0.5)}
        >
          {SEGMENT_LABELS[activeSegment.segment_type] ?? "Passer"}
        </button>
      )}
      {/* 0.3.0 : menus intégrés — panneau flottant + voile de fermeture. */}
      {openMenu && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 55 }}
          onClick={() => setOpenMenu(null)}
        />
      )}
      {openMenu && (
        <div style={MENU_PANEL_STYLE}>
          {openMenu === "audio" &&
            (tracks.audio.length === 0 ? (
              <span style={{ padding: "6px 10px", opacity: 0.7 }}>Aucune piste audio</span>
            ) : (
              tracks.audio.map((track, index) => (
                <button
                  key={`audio-${track.id}`}
                  style={menuItemStyle(track.selected)}
                  onClick={() => {
                    void playerApi.setAudioTrack(track.id);
                    setOpenMenu(null);
                  }}
                >
                  {trackLabel(track, index)}
                </button>
              ))
            ))}
          {openMenu === "subtitles" && (
            <>
              <button
                style={menuItemStyle(!tracks.subtitles.some((t) => t.selected))}
                onClick={() => {
                  void playerApi.setSubtitleTrack(null);
                  setOpenMenu(null);
                }}
              >
                Aucun
              </button>
              {tracks.subtitles.map((track, index) => (
                <button
                  key={`sub-${track.id}`}
                  style={menuItemStyle(track.selected)}
                  onClick={() => {
                    void playerApi.setSubtitleTrack(track.id);
                    setOpenMenu(null);
                  }}
                >
                  {trackLabel(track, index)}
                </button>
              ))}
            </>
          )}
          {openMenu === "display" &&
            (Object.keys(DISPLAY_MODE_LABELS) as Array<keyof typeof DISPLAY_MODE_LABELS>).map(
              (mode) => (
                <button
                  key={mode}
                  style={menuItemStyle(displayMode === mode)}
                  onClick={() => {
                    setDisplayMode(mode);
                    setOpenMenu(null);
                  }}
                >
                  {DISPLAY_MODE_LABELS[mode]}
                </button>
              )
            )}
          {openMenu === "shader" &&
            SHADER_PRESETS.map((preset) => (
              <button
                key={preset}
                style={menuItemStyle(shaderPreset === preset)}
                onClick={() => {
                  void playerApi.setPostShader(preset);
                  setShaderPreset(preset);
                  setOpenMenu(null);
                }}
              >
                {SHADER_LABELS[preset]}
              </button>
            ))}
          {openMenu === "segments" && (
            <>
              {(segmentCtx?.segments ?? []).map((s) => (
                <button
                  key={`del-${s.segment_type}`}
                  style={menuItemStyle(false)}
                  onClick={() => {
                    if (segmentCtx?.episode_id != null) {
                      void invoke("delete_episode_segment", {
                        episodeId: segmentCtx.episode_id,
                        segmentType: s.segment_type,
                      }).then(reloadSegments);
                    }
                    setOpenMenu(null);
                  }}
                >
                  Supprimer {s.segment_type} ({Math.round(s.start_seconds)}–
                  {Math.round(s.end_seconds)} s{s.source === "auto" ? ", auto" : ""})
                </button>
              ))}
              {(["intro", "outro", "recap"] as const).map((type) =>
                pendingMark?.type === type ? (
                  <button
                    key={type}
                    style={menuItemStyle(true)}
                    onClick={() => {
                      if (segmentCtx?.episode_id != null && position > pendingMark.start + 3) {
                        void invoke("set_episode_segment", {
                          episodeId: segmentCtx.episode_id,
                          segmentType: type,
                          startSeconds: pendingMark.start,
                          endSeconds: position,
                        }).then(reloadSegments);
                      }
                      setPendingMark(null);
                      setOpenMenu(null);
                    }}
                  >
                    ✔ Fin {type} ici ({formatTime(position)})
                  </button>
                ) : (
                  <button
                    key={type}
                    style={menuItemStyle(false)}
                    onClick={() => {
                      setPendingMark({ type, start: position });
                      setOpenMenu(null);
                    }}
                  >
                    Début {type} ici ({formatTime(position)})
                  </button>
                )
              )}
              {pendingMark && (
                <button style={menuItemStyle(false)} onClick={() => setPendingMark(null)}>
                  Annuler le marquage
                </button>
              )}
            </>
          )}
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
        {variant === "normal" && (
          <IconButton label="Piste suivante" onClick={playNext} disabled={!hasNext}>
            <SkipForward size={16} />
          </IconButton>
        )}
        <span className="avm-player__time">{formatTime(position)}</span>
        <div style={{ position: "relative", flex: 1 }}>
          {/* 0.4.0 : barre verte de préchargement derrière la progression. */}
          {duration > 0 && buffered > position && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: "50%",
                transform: "translateY(-50%)",
                height: 4,
                width: `${Math.min(100, (buffered / duration) * 100)}%`,
                background: "rgba(74,222,128,.45)",
                borderRadius: 2,
                pointerEvents: "none",
              }}
              title="Préchargement"
            />
          )}
          <Slider
            value={position}
            max={duration || 1}
            step={0.5}
            onChange={seek}
            ariaLabel="Progression de la lecture"
          />
          {/* 0.3.0 : marqueurs de segments sur la barre de progression. */}
          {segmentCtx?.segments.map((s) => (
            <div
              key={`mark-${s.segment_type}`}
              style={{
                position: "absolute",
                left: `${(s.start_seconds / (duration || 1)) * 100}%`,
                width: `${Math.max(((s.end_seconds - s.start_seconds) / (duration || 1)) * 100, 0.5)}%`,
                top: "50%",
                height: 4,
                transform: "translateY(-50%)",
                background:
                  s.segment_type === "intro"
                    ? "rgba(124,92,255,0.6)"
                    : s.segment_type === "outro"
                      ? "rgba(255,160,60,0.6)"
                      : "rgba(80,200,120,0.6)",
                borderRadius: 2,
                pointerEvents: "none",
              }}
              title={SEGMENT_LABELS[s.segment_type] ?? s.segment_type}
            />
          ))}
        </div>
        <span className="avm-player__time">{formatTime(duration)}</span>
        <EndsAtLabel position={position} duration={duration} />
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
            <IconButton label="Piste audio" onClick={() => void toggleMenu("audio")}>
              <AudioLines size={16} />
            </IconButton>
            <IconButton label="Sous-titres" onClick={() => void toggleMenu("subtitles")}>
              <Captions size={16} />
            </IconButton>
            <IconButton
              label="Segments (intro / générique / résumé)"
              onClick={() => void toggleMenu("segments")}
            >
              <Scissors size={16} />
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
            onClick={() => void toggleMenu("display")}
          >
            <Crop size={16} />
          </IconButton>
        )}
        {/* 0.4.0 : bouton shaders restauré ✨ */}
        {variant === "normal" && (
          <IconButton
            label={`Post-traitement (${SHADER_LABELS[shaderPreset] ?? shaderPreset})`}
            onClick={() => void toggleMenu("shader")}
          >
            <Wand2
              size={16}
              style={shaderPreset !== "off" ? { color: "var(--color-accent)" } : undefined}
            />
          </IconButton>
        )}
        {variant === "normal" && (
          <IconButton
            label={loopEnabled ? "Désactiver la lecture en boucle" : "Lire en boucle"}
            onClick={toggleLoop}
          >
            <Repeat1 size={16} style={loopEnabled ? { color: "var(--color-accent)" } : undefined} />
          </IconButton>
        )}
        {variant === "normal" && (
          <IconButton
            label={
              autoNextEnabled
                ? "Désactiver l'enchaînement auto (binge)"
                : "Activer l'enchaînement auto (binge)"
            }
            onClick={toggleAutoNext}
          >
            <ListVideo
              size={16}
              style={autoNextEnabled ? { color: "var(--color-accent)" } : undefined}
            />
          </IconButton>
        )}
        {variant === "normal" && (
          <IconButton label="Capturer une image" onClick={() => void handleCaptureScreenshot()}>
            <Camera size={16} />
          </IconButton>
        )}
        {/* 0.4.0 : épinglette — en vue YouTube, ouvre la fenêtre de lecture
        détachée au lieu du flottant pleine fenêtre. */}
        {variant === "normal" && !isDetached && floatMode === "detach" && (
          <IconButton
            label="Ouvrir dans la fenêtre de lecture flottante"
            onClick={toggleDetached}
          >
            <Pin size={16} />
          </IconButton>
        )}
        {variant === "normal" && !isDetached && floatMode === "window" && (
          <IconButton
            label="Mode flottant (toujours au-dessus, sans bordure)"
            onClick={() => void windowApi.toggleFloatingPlayer()}
          >
            <Pin size={16} />
          </IconButton>
        )}
        {variant === "normal" && !isDetached && (
          <IconButton
            label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </IconButton>
        )}
        {/* 0.4.0 : en PiP, la croix REVIENT à la fenêtre principale au lieu
        de tout stopper. */}
        <IconButton
          label={variant === "detached" ? "Revenir à la fenêtre principale" : "Fermer le lecteur"}
          onClick={variant === "detached" ? toggleDetached : stop}
        >
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
          <div
            data-tauri-drag-region=""
            style={{ ...edge, top: 0, left: 0, right: 0, height: 22, cursor: "move" }}
          />
          <div
            onMouseDown={() => startResize("North")}
            style={{ ...edge, top: 0, left: 22, right: 22, height: 6, cursor: "ns-resize" }}
          />
          <div
            onMouseDown={() => startResize("South")}
            style={{ ...edge, bottom: 0, left: 22, right: 22, height: 6, cursor: "ns-resize" }}
          />
          <div
            onMouseDown={() => startResize("West")}
            style={{ ...edge, left: 0, top: 22, bottom: 22, width: 6, cursor: "ew-resize" }}
          />
          <div
            onMouseDown={() => startResize("East")}
            style={{ ...edge, right: 0, top: 22, bottom: 22, width: 6, cursor: "ew-resize" }}
          />
          <div
            onMouseDown={() => startResize("NorthWest")}
            style={{ ...edge, top: 0, left: 0, width: 12, height: 12, cursor: "nwse-resize" }}
          />
          <div
            onMouseDown={() => startResize("NorthEast")}
            style={{ ...edge, top: 0, right: 0, width: 12, height: 12, cursor: "nesw-resize" }}
          />
          <div
            onMouseDown={() => startResize("SouthWest")}
            style={{ ...edge, bottom: 0, left: 0, width: 12, height: 12, cursor: "nesw-resize" }}
          />
          <div
            onMouseDown={() => startResize("SouthEast")}
            style={{ ...edge, bottom: 0, right: 0, width: 12, height: 12, cursor: "nwse-resize" }}
          />
        </div>
      )}
    </div>
  );
}

function EndsAtLabel({ position, duration }: { position: number; duration: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setTick((t) => t + 1), 30000);
    return () => window.clearInterval(interval);
  }, []);
  if (!duration || duration <= 0) return null;
  const remaining = Math.max(0, duration - position);
  const end = new Date(Date.now() + remaining * 1000);
  return (
    <span
      className="avm-player__time"
      style={{ fontSize: "0.72rem", opacity: 0.75, whiteSpace: "nowrap" }}
      title="Heure de fin estimée"
    >
      · fin à {end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}