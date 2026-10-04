import { useRef } from "react";
import { useVisualizer } from "./useVisualizer";

export function VisualizerCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useVisualizer(ref);
  return (
    <canvas
      ref={ref}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 0, // sous l'UI de l'overlay
      }}
    />
  );
}