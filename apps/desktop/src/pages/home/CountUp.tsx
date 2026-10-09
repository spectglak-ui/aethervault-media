import { useEffect, useState } from "react";

/**
 * Compteur animé : monte de 0 à `target` (ease-out). Si l'utilisateur
 * a demandé de réduire les animations, la valeur finale est affichée
 * immédiatement.
 */
export function useCountUp(target: number, durationMs = 1100): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!Number.isFinite(target) || target <= 0) {
      setValue(Number.isFinite(target) ? target : 0);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const shown = useCountUp(value);
  return (
    <>
      {shown.toLocaleString("fr-FR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </>
  );
}
