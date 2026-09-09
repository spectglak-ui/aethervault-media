import { useEffect, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { playerApi } from "../features/player/api";
import { usePlayer } from "./PlayerContext";

interface PlayerSurfaceProps {
  className?: string;
}

const VERTEX_SHADER_SOURCE = `attribute vec2 aPosition; attribute vec2 aTexCoord; varying vec2 vTexCoord; void main() { gl_Position = vec4(aPosition, 0.0, 1.0); vTexCoord = aTexCoord; }`;
const FRAGMENT_SHADER_SOURCE = `precision mediump float; varying vec2 vTexCoord; uniform sampler2D uTexture; uniform vec2 uTexSize; uniform float uMode; vec3 sampleVideo(vec2 uv) { return texture2D(uTexture, uv).rgb; } vec3 sharpen(vec3 c) { vec2 px = 1.0 / uTexSize; vec3 n = sampleVideo(vTexCoord + vec2(0.0, px.y)); vec3 s = sampleVideo(vTexCoord - vec2(0.0, px.y)); vec3 w = sampleVideo(vTexCoord - vec2(px.x, 0.0)); vec3 e = sampleVideo(vTexCoord + vec2(px.x, 0.0)); vec3 blur = (n + s + w + e) * 0.25; return clamp(c + (c - blur) * 0.6, 0.0, 1.0); } vec3 vivid(vec3 c) { float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, 1.25); c = (c - 0.5) * 1.08 + 0.5; return clamp(c, 0.0, 1.0); } vec3 anime(vec3 c) { vec2 px = 1.0 / uTexSize; vec3 n = sampleVideo(vTexCoord + vec2(0.0, px.y)); vec3 s = sampleVideo(vTexCoord - vec2(0.0, px.y)); vec3 w = sampleVideo(vTexCoord - vec2(px.x, 0.0)); vec3 e = sampleVideo(vTexCoord + vec2(px.x, 0.0)); vec3 blur = (n + s + w + e) * 0.25; c = clamp(c + (c - blur) * 0.45, 0.0, 1.0); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, 1.15); return clamp(c, 0.0, 1.0); } void main() { vec3 c = sampleVideo(vTexCoord); if (uMode < 0.5) { gl_FragColor = vec4(c, 1.0); } else if (uMode < 1.5) { gl_FragColor = vec4(sharpen(c), 1.0); } else if (uMode < 2.5) { gl_FragColor = vec4(vivid(c), 1.0); } else { gl_FragColor = vec4(anime(c), 1.0); } }`;
const SHADER_MODES: Record<string, number> = { off: 0, sharp: 1, vivid: 2, anime: 3 };

/** 0.5.5 (B) : trame décodée de son en-tête 16 octets. */
interface ParsedFrame {
  width: number;
  height: number;
  pts: number; // ms média
  pixels: Uint8Array;
}

export function PlayerSurface({ className }: PlayerSurfaceProps) {
  const { currentMedia, displayMode, isPlaying, buffered, position, duration } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shaderModeRef = useRef(0);
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  // 0.5.5 (B) : ancre d'horloge média — mise à jour UNIQUEMENT quand la
  // position change vraiment (sinon un re-render pour une autre raison
  // recalerait l'horloge sur une position périmée).
  const mediaAnchorRef = useRef({ posMs: 0, wall: 0 });
  const lastPosRef = useRef<number | null>(null);
  if (lastPosRef.current !== position) {
    lastPosRef.current = position;
    mediaAnchorRef.current = { posMs: position * 1000, wall: performance.now() };
  }

  useEffect(() => {
    let disposed = false;
    playerApi
      .getPostShader()
      .then((preset) => {
        if (!disposed) shaderModeRef.current = SHADER_MODES[preset] ?? 0;
      })
      .catch(() => {});
    let unlisten: (() => void) | undefined;
    let shaderDisposed = false;
    void listen<string>("post-shader-changed", (event) => {
      shaderModeRef.current = SHADER_MODES[event.payload] ?? 0;
    }).then((fn) => {
      if (shaderDisposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      shaderDisposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.objectFit =
      displayMode === "stretch" ? "fill" : displayMode === "cover" ? "cover" : "contain";
  }, [displayMode]);

  useEffect(() => {
    if (!currentMedia) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.background = "#000";
    canvas.style.objectFit =
      displayMode === "stretch" ? "fill" : displayMode === "cover" ? "cover" : "contain";
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
    let polling = false;
    let guardLogged = false;
    let drawnLogged = false;
    let lastFrameAt = 0;
    let lastRedrawAt = 0;
    let stallProbe: number | undefined;

    // 0.5.5 (R1+B) : file de trames horodatées ; une seule trame dessinée
    // par vsync.
    let frameQueue: ParsedFrame[] = [];
	let ptsBroken = false;
    let lastFramePts = -1;
    let rafId = 0;
    // 0.5.5 (B-hotfix2) : fiabilité des PTS détectée automatiquement.
    // null = pas encore décidé ; true = mode PTS (anti-judder) ;
    // false = repli R1 (dernière trame par vsync — le mode prouvé fluide).
    let ptsMode: boolean | null = null;
    let ptsSamples = 0;
    let lastDrawWall = 0;
    // 0.5.5 (R2) — instrumentation frontend
    let drawnCount = 0;
    let heldCount = 0;
    let fpsWindowStart = performance.now();
    // 0.5.5 (R4) : crans d'échelle de rendu + compteurs de décision.
    const SCALE_STEPS = [100, 85, 70, 55, 40];
    let scaleIndex = 0;
    let lowWindows = 0;
    let highWindows = 0;
    let fpsProbe: number | undefined;

    const physicalSize = () => {
      const rect = canvas.getBoundingClientRect();
      return {
        width: Math.round(Math.max(rect.width, 1) * ratio),
        height: Math.round(Math.max(rect.height, 1) * ratio),
      };
    };

    /** 0.5.5 (B) : horloge média estimée (ms) à l'instant `wall`. */
    const mediaEstMs = (wall: number): number => {
      const a = mediaAnchorRef.current;
      return a.posMs + (wall - a.wall);
    };

    /** Accusé de réception — jamais de rejet non géré (console propre). */
    const ack = () => {
      playerApi.ackFrame().catch(() => {});
    };

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

    /** 0.5.5 : en-tête 16 octets = [w:u32][h:u32][pts_ms:f64] + pixels. */
    const parseFrame = (message: unknown): ParsedFrame | null => {
      const bytes = toUint8Array(message);
      if (bytes.byteLength < 16) {
        if (!guardLogged) {
          guardLogged = true;
          console.warn("[DIAG] payload trop court pour être une image :", bytes.byteLength, "octets");
        }
        return null;
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(0, true);
      const height = view.getUint32(4, true);
      const pts = view.getFloat64(8, true);
      const expectedLength = 16 + width * height * 4;
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
        return null;
      }
      return {
        width,
        height,
        pts: Number.isFinite(pts) ? pts : 0,
        pixels: new Uint8Array(bytes.buffer, bytes.byteOffset + 16, width * height * 4),
      };
    };

    const drawFrame = (frame: ParsedFrame) => {
      lastFrameAt = performance.now();
      lastDrawWall = lastFrameAt;
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
        gl.viewport(0, 0, frame.width, frame.height);
      }
      gl.uniform2f(uTexSize, frame.width, frame.height);
      gl.uniform1f(uMode, shaderModeRef.current);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        frame.width,
        frame.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        frame.pixels
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      drawnCount += 1;
      if (!drawnLogged) {
        drawnLogged = true;
        console.log("[DIAG] première image dessinée :", frame.width, "x", frame.height);
      }
    };

    /** 0.5.5 (B-hotfix2) : décide si les PTS backend sont exploitables.
     * PTS ≤ 0 ou écart > 3 s avec l'horloge média → repli R1 immédiat.
     * 10 échantillons cohérents → mode PTS (anti-judder 3:2) activé. */
    const decidePtsMode = (frame: ParsedFrame) => {
      if (ptsMode === false) return;
      if (!(frame.pts > 0)) {
        ptsMode = false;
        console.warn("[AV-DIAG] PTS ≤ 0 reçus → présentation PTS désactivée (mode R1)");
        return;
      }
      if (ptsMode === true) return;
      const delta = frame.pts - mediaEstMs(performance.now());
      if (Math.abs(delta) > 3000) {
        ptsMode = false;
        console.warn(`[AV-DIAG] PTS incohérents (écart ${delta.toFixed(0)} ms) → mode R1`);
        return;
      }
      ptsSamples += 1;
      if (ptsSamples >= 10) {
        ptsMode = true;
        console.log("[AV-DIAG] PTS fiables → présentation cadencée par PTS (anti-judder) active");
      }
    };

    /** À chaque vsync : dessine UNE trame. Mode PTS si fiable, sinon R1.
     * Aucun chemin ne peut laisser l'écran noir : filet 500 ms inclus. */
    const presentTick = () => {
      rafId = 0;
      if (disposed) return;
      const now = performance.now();
      let drew = false;
      if (ptsMode === false) {
        // Repli R1 (prouvé fluide) : la trame la plus récente par vsync,
        // les autres consommées + accusées (contre-pression cohérente).
        let latest: ParsedFrame | null = null;
        while (frameQueue.length > 0) {
          const f = frameQueue.shift() as ParsedFrame;
          if (latest) ack();
          latest = f;
        }
        if (latest) {
          drawFrame(latest);
          ack();
          drew = true;
        }
      } else {
        const m = mediaEstMs(now);
        // Trames déjà périmées (arrivées après leur heure) : consommées.
        while (frameQueue.length > 0 && frameQueue[0].pts < m - 500) {
          frameQueue.shift();
          ack();
        }
        // Seek arrière : file entière dans le futur lointain → purge.
        if (frameQueue.length > 0 && frameQueue[0].pts > m + 2000) {
          while (frameQueue.length > 0) {
            frameQueue.shift();
            ack();
          }
        }
        let due: ParsedFrame | null = null;
        while (frameQueue.length > 0 && frameQueue[0].pts <= m + 6) {
          const f = frameQueue.shift() as ParsedFrame;
          if (due) ack();
          due = f;
        }
        // FILET ANTI-ÉCRAN-NOIR : rien de dessiné depuis 500 ms alors que
        // des trames attendent → PTS jugés inutilisables, bascule en R1
        // et dessine immédiatement la trame la plus récente.
        if (!due && frameQueue.length > 0 && now - lastDrawWall > 500) {
          due = frameQueue[frameQueue.length - 1];
          while (frameQueue.length > 0) {
            const f = frameQueue.shift() as ParsedFrame;
            if (f !== due) ack();
          }
          ptsMode = false;
          console.warn("[AV-DIAG] aucune trame échue depuis 500 ms → PTS inutilisables, bascule mode R1");
        }
        if (due) {
          drawFrame(due);
          ack();
          drew = true;
        }
      }
      if (!drew) heldCount += 1;
      if (frameQueue.length > 0) schedulePresent();
    };

    const schedulePresent = () => {
      if (rafId !== 0 || disposed) return;
      rafId = requestAnimationFrame(presentTick);
    };

    const enqueue = (message: unknown, viaChannel: boolean) => {
      lastFrameAt = performance.now();
      if (viaChannel) polling = false;
            const frame = parseFrame(message);
      if (!frame) return;
      // 0.5.5 hotfix v2 : PTS backend inexploitable (0, dénormal ~7e-323
      // issu d'un mauvais format mpv, ou non monotone) → bascule
      // DÉFINITIVE sur un PTS reconstruit à l'arrivée (pacing R1).
      // L'image prime sur le perfectionnement du cadencement.
      if (!ptsBroken) {
        if (!(frame.pts >= 1) || frame.pts <= lastFramePts) {
          ptsBroken = true;
          console.warn(
            "[AV-DIAG] PTS backend invalide (" + frame.pts + ") → repli pacing à l'arrivée"
          );
        }
        lastFramePts = frame.pts;
      }
      if (ptsBroken) {
        frame.pts = mediaEstMs(performance.now());
      }
      frameQueue.push(frame);
      frameQueue.push(frame);
      // Garde-fou : file anormalement longue → on ne garde que les 2
      // trames les plus récentes.
      while (frameQueue.length > 2) {
        frameQueue.shift();
        ack();
      }
      schedulePresent();
    };

    const startPolling = () => {
      if (polling || disposed) return;
      polling = true;
      console.warn("[DIAG] flux idle/canal muet — bascule en mode tirage (player_pull_frame)");
      const tick = () => {
        if (disposed || !polling) return;
        playerApi
          .pullFrame()
          .then((message) => {
            if (!disposed && message) enqueue(message, false);
          })
          .catch(() => {})
          .finally(() => {
            if (!disposed && polling) window.setTimeout(tick, 66);
          });
      };
      tick();
    };

    const channel = new Channel<ArrayBuffer | number[]>();
    channel.onmessage = (message) => {
      enqueue(message, true);
    };

    const initialSize = physicalSize();
    playerApi
      .attachSurface(channel, initialSize.width, initialSize.height)
      .then(async () => {
        if (disposed) return;
        attached = true;
        try {
          await playerApi.redraw();
        } catch {
          // best-effort
        }
        // 0.5.5 (R2) : fps réellement dessiné, toutes les 2 s.
        fpsProbe = window.setInterval(() => {
          if (disposed) return;
          const now = performance.now();
          const seconds = (now - fpsWindowStart) / 1000;
          if (seconds <= 0) return;
          const fps = drawnCount / seconds;
          const mode = ptsMode === null ? "détection" : ptsMode ? "PTS" : "R1";
          console.log(
            `[AV-DIAG] fps dessiné (${seconds.toFixed(1)} s) : ${fps.toFixed(1)} | mode : ${mode} | échelle : ${SCALE_STEPS[scaleIndex]}% | holds : ${heldCount}`
          );
          drawnCount = 0;
          heldCount = 0;
          fpsWindowStart = now;
          // R4 : consommateur à la peine → le producteur rend plus petit ;
          // stable longtemps → on remonte d'un cran.
          if (attached && playingRef.current) {
            if (fps > 0 && fps < 20) {
              lowWindows += 1;
              highWindows = 0;
              if (lowWindows >= 2 && scaleIndex < SCALE_STEPS.length - 1) {
                scaleIndex += 1;
                lowWindows = 0;
                void playerApi.setRenderScale(SCALE_STEPS[scaleIndex]);
              }
            } else if (fps >= 23) {
              highWindows += 1;
              lowWindows = 0;
              if (highWindows >= 5 && scaleIndex > 0) {
                scaleIndex -= 1;
                highWindows = 0;
                void playerApi.setRenderScale(SCALE_STEPS[scaleIndex]);
              }
            } else {
              lowWindows = 0;
              highWindows = 0;
            }
          }
        }, 2000);
        stallProbe = window.setInterval(() => {
          if (disposed || polling || !attached) return;
          const idle =
            lastFrameAt === 0 ? Number.POSITIVE_INFINITY : performance.now() - lastFrameAt;
          if (idle > 2000) {
            // 0.5.5 : une pause légitime n'est PAS un « canal muet ».
            if (playingRef.current) startPolling();
            if (playingRef.current && performance.now() - lastRedrawAt > 3000) {
              lastRedrawAt = performance.now();
              void playerApi.redraw();
            }
          }
        }, 1500);
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
      frameQueue = [];
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
      if (stallProbe !== undefined) window.clearInterval(stallProbe);
      if (fpsProbe !== undefined) window.clearInterval(fpsProbe);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      gl.deleteTexture(texture);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }, [currentMedia]);

  // 0.4.0 : indicateur de mise en mémoire tampon — PUREMENT VISUEL,
  // ne bloque JAMAIS la lecture (mpv gère lui-même la reprise).
  const needsBuffering =
    isPlaying && duration > 0 && buffered > 0 && buffered - position < 5;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <style>{`@keyframes avm-spin { to { transform: rotate(360deg); } }`}</style>
      <canvas
        ref={canvasRef}
        className={[className, `avm-player__surface--${displayMode}`].filter(Boolean).join(" ")}
      />
      {needsBuffering && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,.55)",
            color: "#fff",
            fontSize: 14,
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 20,
                height: 20,
                border: "2px solid rgba(255,255,255,.3)",
                borderTopColor: "#fff",
                borderRadius: "50%",
                animation: "avm-spin .8s linear infinite",
              }}
            />
            Mise en mémoire tampon…
          </div>
        </div>
      )}
    </div>
  );
}