import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { usePlayer } from "../../player/PlayerContext";
import { getWindowLabel } from "../../window/getWindowLabel";

const LS_ENABLED = "avm-remote-enabled";

interface RemoteAction {
  action?: string;
  cmd?: string;
  key?: string;
  route?: string;
  q?: string;
  value?: number;
}

type DirectionKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[role='button']:not([aria-disabled='true'])",
  "[role='link']:not([aria-disabled='true'])",
  "[tabindex]:not([tabindex='-1'])",
  "[data-remote-focus='true']",
].join(",");

function getRemoteFocusables(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => {
    const style = window.getComputedStyle(element);

    return (
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      element.getAttribute("aria-disabled") !== "true" &&
      !element.closest("[hidden], [inert], [aria-hidden='true']") &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      element.getClientRects().length > 0
    );
  });
}

function focusRemoteElement(element: HTMLElement) {
  const styleId = "avm-remote-focus-style";

  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .avm-remote-focus-target {
        outline: 2px solid #7c5cff !important;
        outline-offset: 3px !important;
        box-shadow:
          0 0 0 4px rgba(124, 92, 255, .17),
          0 0 20px rgba(0, 194, 255, .22) !important;
      }
    `;
    document.head.appendChild(style);
  }

  document
    .querySelectorAll<HTMLElement>(".avm-remote-focus-target")
    .forEach((previous) => {
      previous.classList.remove("avm-remote-focus-target");
    });

  element.classList.add("avm-remote-focus-target");
  element.focus({ preventScroll: true });
  element.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "nearest",
  });
}

function moveRemoteFocus(direction: DirectionKey) {
  const elements = getRemoteFocusables();
  if (elements.length === 0) return;

  const active = document.activeElement;
  const current =
    active instanceof HTMLElement
      ? active.matches(FOCUSABLE_SELECTOR)
        ? active
        : active.closest<HTMLElement>(FOCUSABLE_SELECTOR)
      : null;

  // First directional input: start at the visually first available control.
  if (!current || !elements.includes(current)) {
    const first = [...elements].sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    })[0];
    if (first) focusRemoteElement(first);
    return;
  }

  const origin = current.getBoundingClientRect();
  const originX = origin.left + origin.width / 2;
  const originY = origin.top + origin.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of elements) {
    if (candidate === current) continue;

    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    let primaryDistance = 0;
    let crossDistance = 0;
    let aligned = false;

    switch (direction) {
      case "ArrowRight":
        primaryDistance = x - originX;
        crossDistance = Math.abs(y - originY);
        aligned = rect.top < origin.bottom && rect.bottom > origin.top;
        break;
      case "ArrowLeft":
        primaryDistance = originX - x;
        crossDistance = Math.abs(y - originY);
        aligned = rect.top < origin.bottom && rect.bottom > origin.top;
        break;
      case "ArrowDown":
        primaryDistance = y - originY;
        crossDistance = Math.abs(x - originX);
        aligned = rect.left < origin.right && rect.right > origin.left;
        break;
      case "ArrowUp":
        primaryDistance = originY - y;
        crossDistance = Math.abs(x - originX);
        aligned = rect.left < origin.right && rect.right > origin.left;
        break;
    }

    // Ignore candidates behind or directly on the current control.
    if (primaryDistance <= 2) continue;

    // Prefer aligned controls, then the nearest control in the requested direction.
    const score =
      primaryDistance +
      crossDistance * (aligned ? 1.15 : 2.2) +
      (aligned ? 0 : 120);

    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best) focusRemoteElement(best);
}

/**
 * Pont télécommande mobile : traduit les actions JSON reçues du serveur
 * embarqué en navigation et commandes du lecteur, puis renvoie l'état du
 * lecteur au téléphone. Monté une seule fois dans AppShell (fenêtre main).
 */
export function RemoteBridge() {
  const navigate = useNavigate();
  const player = usePlayer();
  const apiRef = useRef(player);
  apiRef.current = player;
  const navRef = useRef(navigate);
  navRef.current = navigate;

  useEffect(() => {
    if (getWindowLabel() !== "main") return;

    try {
      if (localStorage.getItem(LS_ENABLED) === "1") {
        void invoke("remote_start").catch(() => {});
      }
    } catch {
      // Best effort: the remote can also be started manually in settings.
    }
  }, []);

  useEffect(() => {
    if (getWindowLabel() !== "main") return;

    const unlisten = listen<RemoteAction>("remote-action", ({ payload }) => {
      const p = apiRef.current;
      const nav = navRef.current;

      switch (payload.action) {
        case "nav":
          if (typeof payload.route === "string" && payload.route.startsWith("/")) {
            nav(payload.route);
          }
          break;

        case "search":
          if (typeof payload.q === "string" && payload.q.trim()) {
            nav(`/explore?q=${encodeURIComponent(payload.q.trim())}`);
          }
          break;

        case "key": {
          const key = payload.key ?? "";

          if (
            key === "ArrowUp" ||
            key === "ArrowDown" ||
            key === "ArrowLeft" ||
            key === "ArrowRight"
          ) {
            moveRemoteFocus(key);
          } else if (key === "Enter" || key === " ") {
            const target = document.activeElement;
            if (target instanceof HTMLElement) target.click();
          } else if (key === "Escape") {
            nav(-1);
          }
          break;
        }

        case "player":
          switch (payload.cmd) {
            case "toggle":
              p.togglePlay();
              break;
            case "next":
              p.playNext();
              break;
            case "prev":
              p.playPrevious();
              break;
            case "seek+":
              p.seek(Math.min(p.duration || p.position + 10, p.position + 10));
              break;
            case "seek-":
              p.seek(Math.max(0, p.position - 10));
              break;
            case "seek":
              if (typeof payload.value === "number") p.seek(Math.max(0, payload.value));
              break;
            case "vol":
              if (typeof payload.value === "number") {
                p.setVolumeLevel(Math.max(0, Math.min(1, payload.value)));
              }
              break;
            case "mute":
              p.toggleMuted();
              break;
            case "full":
              p.toggleFullscreen();
              break;
            case "stop":
              p.stop();
              break;
            case "shuffle":
              p.toggleShuffle();
              break;
            case "loop":
              p.toggleLoop();
              break;
            default:
              break;
          }
          break;

        default:
          break;
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const snapshotRef = useRef<() => void>(() => {});
  snapshotRef.current = () => {
    const p = apiRef.current;
    const m = p.currentMedia;
    const cover =
      m?.thumbnail ??
      (m?.youtubeId ? `https://i.ytimg.com/vi/${m.youtubeId}/hqdefault.jpg` : null);

    void emit("remote-state", {
      type: "state",
      title: m?.title ?? null,
      artist: m?.channel ?? null,
      cover,
      playing: p.isPlaying,
      position: p.position,
      duration: p.duration,
      volume: p.muted ? 0 : p.volume,
      queueLength: p.queue.items.length,
    }).catch(() => {});
  };

  useEffect(() => {
    if (getWindowLabel() !== "main") return;

    snapshotRef.current();
    const timer = window.setInterval(() => snapshotRef.current(), 1200);
    return () => window.clearInterval(timer);
  }, [player.currentMedia?.id, player.isPlaying]);

  return null;
}
