import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { AmbientVisualizer, type SpectrumFrame } from "./AmbientVisualizer";
import { usePlayer } from "../PlayerContext";

export function useVisualizer(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const { currentMedia, isPlaying, position } = usePlayer();
  const vizRef = useRef<AmbientVisualizer | null>(null);
  const lastPosRef = useRef(0);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const viz = new AmbientVisualizer(cv);
    vizRef.current = viz;
    return () => {
      viz.destroy();
      vizRef.current = null;
    };
  }, [canvasRef]);

  // Démarre/arrête la capture Rust. `expected_path` = média affiché :
  // tant que l'extraction yt-dlp n'a pas rempli `last_source` /
  // `audio_origin` côté Rust, la commande répond en erreur → retry
  // 500 ms (12 tentatives max).
  useEffect(() => {
    const media = currentMedia;
    console.log("[visualizer] gate :", media?.mode, isPlaying, media?.path);
        if (!media || media.mode !== "audio" || !isPlaying) {
      void invoke("visualizer_stop").catch(() => {});
      vizRef.current?.setActive(false);   // 0.6.1 : fondu, pas de clearRect
      lastPosRef.current = 0;
      return;
    }
    let cancelled = false;
    let retries = 0;
    const tryStart = () => {
      if (cancelled) return;
      invoke("visualizer_start", { expectedPath: media.path })
                .then(() => {
          console.log("[visualizer] capture démarrée");
          vizRef.current?.setActive(true);
          vizRef.current?.start();
        })
        .catch((err) => {
          console.warn("[visualizer] start échoué :", err);
          if (cancelled || retries++ > 12) return;
          window.setTimeout(tryStart, 500);
        });
    };
    tryStart();
        return () => {
      cancelled = true;
      void invoke("visualizer_stop").catch(() => {});
      vizRef.current?.setActive(false);
    };
  }, [currentMedia?.id, currentMedia?.mode, isPlaying]);

  // Seek utilisateur (slider) : saut de position → relance la capture,
  // le thread Rust se resynchronise sur la nouvelle position mpv.
  useEffect(() => {
    const prev = lastPosRef.current;
    lastPosRef.current = position;
    if (prev === 0 || currentMedia?.mode !== "audio" || !isPlaying) return;
    const d = position - prev;
    if (d < -0.5 || d > 2.5) {
      void invoke("visualizer_start", { expectedPath: currentMedia.path }).catch(() => {});
    }
  }, [position, currentMedia?.mode, currentMedia?.path, isPlaying]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<SpectrumFrame>("visualizer-frame", (event) => {
      console.log("[visualizer] frame reçue :", event.payload.bass.toFixed(2));
      vizRef.current?.setFrame(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);
}