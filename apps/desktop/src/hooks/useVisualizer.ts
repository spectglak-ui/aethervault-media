import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Frame émis par le Rust (visualizer/symphonia_cap.rs) ~30 fps :
 * spectre en 24 bandes log + bass/mid/treble + détection de kick (pulse).
 * Le visualiseur Symphonia doit être démarré côté backend
 * (commande `visualizer_start`) — ce hook ne fait que recevoir les frames.
 */
export interface SpectrumFrame {
  bands: number[];
  bass: number;
  mid: number;
  treble: number;
  pulse: number;
}

const EMPTY_FRAME: SpectrumFrame = {
  bands: Array(24).fill(0),
  bass: 0,
  mid: 0,
  treble: 0,
  pulse: 0,
};

export function useVisualizer(): SpectrumFrame {
  const [frame, setFrame] = useState<SpectrumFrame>(EMPTY_FRAME);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const unlisten = listen<SpectrumFrame>("visualizer-frame", (event) => {
      if (!mountedRef.current) return;
      setFrame(event.payload);
    });
    return () => {
      mountedRef.current = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  return frame;
}