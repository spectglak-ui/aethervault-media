import { playerApi } from "../features/player/api";

/**
 * 0.5.6 — Qualité de rendu du lecteur local (rendu logiciel libmpv → canvas).
 * Deux modes proposés dans les Paramètres :
 * - "fluid"  : rendu interne ≈720p puis upscale GPU vers l'écran
 *              (fluidité garantie sur toutes les machines testées) ;
 * - "native" : rendu interne 1080p (qualité maximale, mode test ;
 *              repli adaptatif automatique si la machine ne suit pas).
 * Le choix est persisté en localStorage et appliqué immédiatement
 * (commande `player_set_render_scale`) + diffusé aux lecteurs ouverts
 * via un événement window.
 */
export type RenderQuality = "fluid" | "native";

export const RENDER_QUALITY_KEY = "avm-render-quality";
export const RENDER_QUALITY_EVENT = "avm-render-quality-changed";

/** Crans d'échelle de rendu (% de la surface) par mode. */
export const RENDER_QUALITY_STEPS: Record<RenderQuality, readonly number[]> = {
  fluid: [66, 55, 45], // ≈720p sur une surface 1080p → upscale GL gratuit
  native: [100, 85, 70], // 1080p natif, repli adaptatif si saturé
};

export function getRenderQuality(): RenderQuality {
  try {
    return localStorage.getItem(RENDER_QUALITY_KEY) === "native" ? "native" : "fluid";
  } catch {
    return "fluid";
  }
}

export function setRenderQuality(quality: RenderQuality): void {
  try {
    localStorage.setItem(RENDER_QUALITY_KEY, quality);
  } catch {
    // best-effort
  }
  window.dispatchEvent(
    new CustomEvent<RenderQuality>(RENDER_QUALITY_EVENT, { detail: quality })
  );
  void playerApi.setRenderScale(RENDER_QUALITY_STEPS[quality][0]);
}

export function onRenderQualityChange(cb: (q: RenderQuality) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<RenderQuality>).detail);
  window.addEventListener(RENDER_QUALITY_EVENT, handler);
  return () => window.removeEventListener(RENDER_QUALITY_EVENT, handler);
}