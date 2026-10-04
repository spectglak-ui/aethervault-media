import { useEffect, useRef } from "react";

/**
 * 0.6.3 — Fond animé de l'écran de sélection de profil (AuthGate) :
 * champ d'étoiles discret (points minuscules en dérive lente +
 * scintillement subtil) sur fond noir, reproduit du mockup vidéo
 * fourni. Canvas FIXE derrière le contenu (zIndex 0), non interactif
 * (pointerEvents: none) — jamais au-dessus des boutons de profil.
 *
 * `prefers-reduced-motion` : une seule image statique est dessinée
 * (pas de boucle RAF) — même garde-fou que le visualiseur AetherFy.
 * Densité volontairement faible (~1 étoile / 9 000 px²) : effet
 * « ciel profond », pas « neige ».
 */
export function StarfieldBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let running = true;

    type Star = {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      base: number;
      phase: number;
      speed: number;
    };
    let stars: Star[] = [];

    const spawn = () => {
      const count = Math.round((width * height) / 9000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.4 + Math.random() * 0.9, // 0,4–1,3 px : points minuscules
        vx: -(2 + Math.random() * 4), // px/s — dérive lente
        vy: 1 + Math.random() * 3,
        base: 0.35 + Math.random() * 0.55, // luminosité de base
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.2, // vitesse de scintillement
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      spawn();
    };

    resize();
    window.addEventListener("resize", resize);

    let last = performance.now();
    const draw = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);

      for (const s of stars) {
        if (!reduced) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          // Enroulement torique avec marge : aucun « pop » visible
          // quand une étoile sort de l'écran.
          if (s.x < -2) s.x = width + 2;
          if (s.x > width + 2) s.x = -2;
          if (s.y < -2) s.y = height + 2;
          if (s.y > height + 2) s.y = -2;
        }
        const twinkle = reduced ? 1 : 0.72 + 0.28 * Math.sin(t * s.speed + s.phase);
        ctx.globalAlpha = Math.min(1, s.base * twinkle);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        display: "block",
      }}
    />
  );
}