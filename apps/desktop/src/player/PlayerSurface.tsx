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

/**
 * Surface de rendu vidéo (canvas WebGL) — consommateur du canal Tauri
 * ouvert par `player_attach_surface` (voir `sw_render.rs` côté Rust).
 *
 * 0.5.6 — version consolidée finale :
 * - UN SEUL `push` par message reçu (le double push historique doublait
 *   les accusés → comptabilité `in_flight` faussée côté Rust → trames
 *   sautées = micro-saccades) ;
 * - INVARIANT : exactement UN ack par trame sortie de la file (dessinée
 *   OU jetée), jamais plus, jamais moins ;
 * - PTS backend : 0 à la première trame est NORMAL ; un PTS négatif ou
 *   non monotone (backend cassé qui renvoie toujours 0) → repli R1
 *   définitif (PTS reconstruit à l'arrivée) ; PTS valides et monotones →
 *   mode PTS (anti-judder 3:2) après 10 échantillons cohérents ;
 * - R4 0.5.6 : DESCENTE SEULE (latch), seuil 22 fps (« sous la cadence
 *   source 24 » : à 100 % le consommateur plafonnait à ~19 fps dessinés
 *   = ≈10 trames/2 s sautées côté Rust), grâce 6 s au démarrage,
 *   cooldown 8 s entre deux changements — fini le ping-pong d'échelle ;
 * - filet anti-écran-noir 500 ms inclus dans tous les chemins.
 */
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
    // File de trames horodatées ; UNE seule trame dessinée par vsync.
    let frameQueue: ParsedFrame[] = [];
    let ptsBroken = false;
    let lastFramePts = -1;
    let rafId = 0;
    // null = pas encore décidé ; true = mode PTS (anti-judder) ;
    // false = repli R1 (dernière trame par vsync — le mode prouvé fluide).
    let ptsMode: boolean | null = null;
    let ptsSamples = 0;
    let lastDrawWall = 0;
    // Instrumentation
    let drawnCount = 0;
    let heldCount = 0;
    let fpsWindowStart = performance.now();
    // R4 0.5.6 : descente seule + grâce démarrage + cooldown 8 s.
    const SCALE_STEPS = [100, 85, 70, 55, 40];
    let scaleIndex = 0;
    let lowWindows = 0;
    let lastScaleChangeAt = 0;
    let r4GraceUntil = 0;
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
    /** 0.5.6 : décide si les PTS BRUTS backend sont exploitables (appelé
     * par enqueue sur PTS valides et monotones uniquement). Écart > 3 s
     * avec l'horloge média → R1. 10 échantillons cohérents → mode PTS. */
    const decidePtsMode = (frame: ParsedFrame) => {
      if (ptsMode === false || ptsMode === true) return;
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
     * INVARIANT : exactement UN ack par trame sortie de la file.
     * Aucun chemin ne laisse l'écran noir : filet 500 ms inclus. */
    const presentTick = () => {
      rafId = 0;
      if (disposed) return;
      const now = performance.now();
      let drew = false;
      if (ptsMode === true) {
        const m = mediaEstMs(now);
        // Trames périmées (arrivées après leur heure) : consommées + ack.
        while (frameQueue.length > 0 && frameQueue[0].pts < m - 500) {
          frameQueue.shift();
          ack();
        }
        // Seek arrière : file entière dans le futur lointain → purge + ack.
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
        // des trames attendent → PTS jugés inutilisables, bascule en R1.
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
      } else {
        // Repli R1 (prouvé fluide) : la trame la plus récente par vsync,
        // les autres consommées + accusées (UNE fois chacune).
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
      // 0.5.6 : décision de mode sur les PTS BRUTS, avant reconstruction.
      // PTS = 0 à la première trame est NORMAL (lastFramePts démarre à
      // -1) ; un backend cassé qui renvoie TOUJOURS 0 est détecté dès la
      // 2e trame (non monotone) → repli R1 définitif.
      if (!ptsBroken) {
        if (frame.pts < 0 || frame.pts <= lastFramePts) {
          ptsBroken = true;
          ptsMode = false;
          console.warn(
            "[AV-DIAG] PTS backend invalide (" + frame.pts + ") → repli R1 définitif"
          );
        } else {
          lastFramePts = frame.pts;
          decidePtsMode(frame);
        }
      }
      if (ptsBroken) {
        // PTS reconstruit à l'arrivée : le pacing devient « dessine la
        // dernière trame reçue par vsync » (R1), prouvé fluide.
        frame.pts = mediaEstMs(performance.now());
      }
      // 0.5.6 : UN SEUL push par message (le double push historique
      // doublait les accusés → in_flight faussé → trames sautées Rust).
      frameQueue.push(frame);
      // Garde-fou : file anormalement longue → trames jetées + ack
      // (elles ont été envoyées par Rust, il faut libérer in_flight).
      while (frameQueue.length > 3) {
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
        // 0.5.6 : grâce R4 — ignore la rampe de démarrage (décodage +
        // premier remplissage de file), sinon R4 descendait sur des fps
        // de montée en charge (8-14 fps les 4 premières secondes).
        r4GraceUntil = performance.now() + 6000;
        try {
          await playerApi.redraw();
        } catch {
          // best-effort
        }
        fpsProbe = window.setInterval(() => {
          if (disposed) return;
          const now = performance.now();
          const seconds = (now - fpsWindowStart) / 1000;
          if (seconds <= 0) return;
          const fps = drawnCount / seconds;
          // 0.5.6 : silence en fin de lecture (keep-open) / pause longue :
          // plus de spam « fps 0.0 » dans la console.
          if (drawnCount === 0 && !playingRef.current) {
            heldCount = 0;
            fpsWindowStart = now;
            return;
          }
          const mode = ptsMode === null ? "détection" : ptsMode ? "PTS" : "R1";
          console.log(
            `[AV-DIAG] fps dessiné (${seconds.toFixed(1)} s) : ${fps.toFixed(1)} | mode : ${mode} | échelle : ${SCALE_STEPS[scaleIndex]}% | holds : ${heldCount}`
          );
          drawnCount = 0;
          heldCount = 0;
          fpsWindowStart = now;
          // R4 0.5.6 : DESCENTE SEULE (latch), seuil 22 fps = « sous la
          // cadence source 24 ». À 100 % le consommateur plafonnait à
          // ~19 fps dessinés (≈10 trames/2 s sautées côté Rust = micro-
          // saccades) : l'ancien seuil 18 ne réagissait jamais. Grâce 6 s
          // au démarrage ; cooldown 8 s ; aucune remontée automatique
          // (chaque changement d'échelle = reconfig mpv = hitch visible).
          if (attached && playingRef.current && now > r4GraceUntil) {
            const since = now - lastScaleChangeAt;
            if (fps > 0 && fps < 22) {
              lowWindows += 1;
              if (lowWindows >= 3 && since > 8000 && scaleIndex < SCALE_STEPS.length - 1) {
                scaleIndex += 1;
                lowWindows = 0;
                lastScaleChangeAt = now;
                void playerApi.setRenderScale(SCALE_STEPS[scaleIndex]);
              }
            } else {
              lowWindows = 0;
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