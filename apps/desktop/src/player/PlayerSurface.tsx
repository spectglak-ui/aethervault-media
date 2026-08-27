import { useEffect, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { playerApi } from "../features/player/api";
import { usePlayer } from "./PlayerContext";

interface PlayerSurfaceProps {
  className?: string;
}

const VERTEX_SHADER_SOURCE = `attribute vec2 aPosition; attribute vec2 aTexCoord; varying vec2 vTexCoord; void main() { gl_Position = vec4(aPosition, 0.0, 1.0); vTexCoord = aTexCoord; }`;

/** Étape 8 (Option A) : UN SEUL fragment shader contenant les 4 presets
 * de post-traitement, sélectionnés par `uMode` (0 = désactivé). Changer
 * de preset ne reconstruit JAMAIS le pipeline WebGL et ne ré-attache
 * jamais la surface mpv : seul l'uniform change, appliqué à la frame
 * suivante — aucun risque de gel (l'ancienne approche « recompiler +
 * re-attach » figeait l'image). */
const FRAGMENT_SHADER_SOURCE = `precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform float uMode;
vec3 sampleVideo(vec2 uv) { return texture2D(uTexture, uv).rgb; }
vec3 sharpen(vec3 c) {
  vec2 px = 1.0 / uTexSize;
  vec3 n = sampleVideo(vTexCoord + vec2(0.0, px.y));
  vec3 s = sampleVideo(vTexCoord - vec2(0.0, px.y));
  vec3 w = sampleVideo(vTexCoord - vec2(px.x, 0.0));
  vec3 e = sampleVideo(vTexCoord + vec2(px.x, 0.0));
  vec3 blur = (n + s + w + e) * 0.25;
  return clamp(c + (c - blur) * 0.6, 0.0, 1.0);
}
vec3 vivid(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.25);
  c = (c - 0.5) * 1.08 + 0.5;
  return clamp(c, 0.0, 1.0);
}
vec3 anime(vec3 c) {
  vec2 px = 1.0 / uTexSize;
  vec3 n = sampleVideo(vTexCoord + vec2(0.0, px.y));
  vec3 s = sampleVideo(vTexCoord - vec2(0.0, px.y));
  vec3 w = sampleVideo(vTexCoord - vec2(px.x, 0.0));
  vec3 e = sampleVideo(vTexCoord + vec2(px.x, 0.0));
  vec3 blur = (n + s + w + e) * 0.25;
  c = clamp(c + (c - blur) * 0.45, 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.15);
  return clamp(c, 0.0, 1.0);
}
void main() {
  vec3 c = sampleVideo(vTexCoord);
  if (uMode < 0.5) { gl_FragColor = vec4(c, 1.0); }
  else if (uMode < 1.5) { gl_FragColor = vec4(sharpen(c), 1.0); }
  else if (uMode < 2.5) { gl_FragColor = vec4(vivid(c), 1.0); }
  else { gl_FragColor = vec4(anime(c), 1.0); }
}`;

/** Correspondance identifiants de presets (backend `post_shader`) →
 * valeur du uniform `uMode`. */
const SHADER_MODES: Record<string, number> = { off: 0, sharp: 1, vivid: 2, anime: 3 };

/**
 * Zone où mpv affiche réellement l'image, quelle que soit la fenêtre.
 * Rendu WebGL : chaque image est uploadée comme texture GPU via
 * `texImage2D` puis dessinée sur un quad plein cadre.
 * ⚠️ Repli PiP (canal Tauri muet dans les fenêtres secondaires — prouvé
 * en test réel) : si aucune image n'arrive par le canal dans les 2,5 s,
 * bascule en « mode tirage » (`player_pull_frame`, ~15 fps).
 */
export function PlayerSurface({ className }: PlayerSurfaceProps) {
  const { currentMedia, displayMode } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** Preset de post-traitement courant, lu par le thread de dessin à
   * chaque frame via ce ref — aucun re-render, aucun re-attach. */
  const shaderModeRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    playerApi
      .getPostShader()
      .then((preset) => {
        if (!disposed) shaderModeRef.current = SHADER_MODES[preset] ?? 0;
      })
      .catch(() => {});
    let unlisten: (() => void) | undefined;
    void listen<string>("post-shader-changed", (event) => {
      shaderModeRef.current = SHADER_MODES[event.payload] ?? 0;
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!currentMedia) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ⚠️ Correctif PiP : dans la fenêtre détachée, le canvas restait à sa
    // taille par défaut (300×150) au lieu de remplir la fenêtre — on force
    // un remplissage inline, uniquement dans cette fenêtre.
    if (getCurrentWindow().label === "player") {
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.objectFit =
        displayMode === "stretch" ? "fill" : displayMode === "cover" ? "cover" : "contain";
      canvas.style.background = "#000";
    }

    const gl = (canvas.getContext("webgl", { alpha: false, premultipliedAlpha: false }) ??
      canvas.getContext("experimental-webgl", {
        alpha: false,
        premultipliedAlpha: false,
      })) as WebGLRenderingContext | null;
    if (!gl) {
      console.error("WebGL indisponible sur ce <canvas> — affichage vidéo impossible.");
      return;
    }

    const compileShader = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Erreur de compilation shader :", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    const program = gl.createProgram();
    if (!vertexShader || !fragmentShader || !program) {
      console.error("Impossible de créer le programme WebGL du lecteur vidéo.");
      return;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Erreur de link du programme WebGL :", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // prettier-ignore
    const quad = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ]);
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, stride, 0);
    const aTexCoord = gl.getAttribLocation(program, "aTexCoord");
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);
    const uTexSize = gl.getUniformLocation(program, "uTexSize");
    const uMode = gl.getUniformLocation(program, "uMode");

    const ratio = window.devicePixelRatio || 1;
    let attached = false;
    let disposed = false;
    let receivedFrame = false;
    let polling = false;
    let pullLogged = false;
    let guardLogged = false;
    let drawnLogged = false;
    let watchdog: number | undefined;

    const physicalSize = () => {
      const rect = canvas.getBoundingClientRect();
      return {
        width: Math.round(Math.max(rect.width, 1) * ratio),
        height: Math.round(Math.max(rect.height, 1) * ratio),
      };
    };

    /** Décode le payload quel que soit son type exact (ArrayBuffer,
     * tableau de nombres, ou forme JSON inattendue `{"Raw":[...]}`). */
    const toUint8Array = (message: unknown): Uint8Array => {
      if (message instanceof Uint8Array) return message;
      if (message instanceof ArrayBuffer) return new Uint8Array(message);
      if (Array.isArray(message)) return Uint8Array.from(message);
      if (message && typeof message === "object") {
        const inner =
          (message as { Raw?: unknown }).Raw ??
          (message as { data?: unknown }).data ??
          (message as { bytes?: unknown }).bytes;
        if (inner instanceof ArrayBuffer) return new Uint8Array(inner);
        if (Array.isArray(inner)) return Uint8Array.from(inner);
      }
      return new Uint8Array(0);
    };

    const drawMessage = (message: unknown, ack: boolean) => {
      const bytes = toUint8Array(message);
      if (bytes.byteLength < 8) {
        if (!guardLogged) {
          guardLogged = true;
          console.warn("[DIAG] payload trop court pour être une image :", bytes.byteLength, "octets");
        }
        return;
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(0, true);
      const height = view.getUint32(4, true);
      const expectedLength = 8 + width * height * 4;
      if (width === 0 || height === 0 || bytes.byteLength < expectedLength) {
        if (!guardLogged) {
          guardLogged = true;
          console.warn("[DIAG] garde rejetée :", {
            width,
            height,
            recu: bytes.byteLength,
            attendu: expectedLength,
          });
        }
        return;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      // Preset de post-traitement + taille de la texture, appliqués à
      // chaque frame (changement de preset instantané, sans re-attach).
      gl.uniform2f(uTexSize, width, height);
      gl.uniform1f(uMode, shaderModeRef.current);
      const pixels = new Uint8Array(bytes.buffer, bytes.byteOffset + 8, width * height * 4);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!drawnLogged) {
        drawnLogged = true;
        console.log("[DIAG] première image dessinée :", width, "x", height);
      }
      if (ack) void playerApi.ackFrame();
    };

    /** Mode tirage : tire la dernière image via `player_pull_frame`
     * (~15 fps) — utilisé uniquement quand le canal est muet. */
    const startPolling = () => {
      if (polling || disposed) return;
      polling = true;
      console.warn("[DIAG] canal muet dans cette fenêtre — bascule en mode tirage (player_pull_frame)");
      const tick = () => {
        if (disposed || !polling) return;
        playerApi
          .pullFrame()
          .then((message) => {
            if (!pullLogged) {
              pullLogged = true;
              console.log(
                "[DIAG] pull premier payload :",
                message instanceof ArrayBuffer
                  ? `ArrayBuffer ${message.byteLength} octets`
                  : Array.isArray(message)
                    ? `tableau ${message.length}`
                    : `${typeof message}`
              );
            }
            if (!disposed && message) drawMessage(message, false);
          })
          .catch((err) => {
            if (!pullLogged) {
              pullLogged = true;
              console.error("[DIAG] pullFrame en erreur :", err);
            }
          })
          .finally(() => {
            if (!disposed && polling) window.setTimeout(tick, 66);
          });
      };
      tick();
    };

    const channel = new Channel<ArrayBuffer | number[]>();
    channel.onmessage = (message) => {
      if (!receivedFrame) {
        receivedFrame = true;
        if (watchdog !== undefined) {
          window.clearTimeout(watchdog);
          watchdog = undefined;
        }
        polling = false; // le canal fonctionne finalement : stop tirage
        console.log("[DIAG] première image reçue par le canal");
      }
      drawMessage(message, true);
    };

    const initialSize = physicalSize();
    playerApi
      .attachSurface(channel, initialSize.width, initialSize.height)
      .then(async () => {
        if (disposed) return;
        attached = true;
        // ⚠️ Correctif PiP : force mpv à produire une nouvelle frame pour
        // cette surface. Sans ce seek relatif de 0 s, mpv considère la
        // frame courante comme déjà "consommée" et ne réveille plus le
        // wake callback — le slot LATEST_FRAME resterait figé sur la même
        // image, et le PiP afficherait une vidéo fixe.
        try {
          await playerApi.redraw();
        } catch {
          // best-effort : un échec ici ne bloque pas le rendu
        }
        watchdog = window.setTimeout(() => {
          if (!disposed && !receivedFrame) startPolling();
        }, 2500);
      })
      .catch((err) => {
        console.error("Impossible d'attacher la surface vidéo :", err);
      });

    const sync = () => {
      if (!attached) return;
      const size = physicalSize();
      void playerApi.resizeSurface(size.width, size.height);
    };
    const observer = new ResizeObserver(sync);
    observer.observe(canvas);
    window.addEventListener("resize", sync);

    return () => {
      disposed = true;
      polling = false;
      if (watchdog !== undefined) window.clearTimeout(watchdog);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      gl.deleteTexture(texture);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }, [currentMedia]);

  return (
    <canvas
      ref={canvasRef}
      className={[className, `avm-player__surface--${displayMode}`].filter(Boolean).join(" ")}
    />
  );
}