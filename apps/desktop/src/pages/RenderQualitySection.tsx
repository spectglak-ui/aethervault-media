import { useState } from "react";
import { getRenderQuality, setRenderQuality, type RenderQuality } from "../player/renderQuality";

/**
 * 0.5.6 — Paramètres → Qualité de rendu : propose les deux méthodes de
 * lecture (720p upscalé = fluidité garantie / 1080p natif = mode test).
 */
export function RenderQualitySection() {
  const [quality, setQuality] = useState<RenderQuality>(() => getRenderQuality());
  const choose = (q: RenderQuality) => {
    setQuality(q);
    setRenderQuality(q);
  };
  return (
    <section className="avm-settings-section">
      <h2>Qualité de rendu (lecture locale)</h2>
      <p className="avm-settings-muted">
        Le rendu vidéo est logiciel (libmpv → canvas). Choisissez le compromis
        qualité / fluidité appliqué au lecteur.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="radio"
            name="avm-render-quality"
            checked={quality === "fluid"}
            onChange={() => choose("fluid")}
          />
          <span>
            <strong>720p upscalé — fluidité garantie (recommandé)</strong>
            <br />
            <span className="avm-settings-muted">
              Rendu interne ≈720p puis upscale GPU vers l'écran : aucune saccade
              sur toutes les machines testées.
            </span>
          </span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="radio"
            name="avm-render-quality"
            checked={quality === "native"}
            onChange={() => choose("native")}
          />
          <span>
            <strong>1080p natif — mode test</strong>
            <br />
            <span className="avm-settings-muted">
              Rendu interne 1080p (qualité maximale) ; peut présenter des
              micro-saccades selon la machine (repli automatique si trop lent).
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}