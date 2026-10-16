import { useState } from "react";
import { getRenderQuality, setRenderQuality, type RenderQuality } from "../player/renderQuality";

/**
 * Paramètres → Qualité de rendu : propose les deux méthodes de lecture
 * (1080p natif = qualité maximale, stable / 720p upscalé = plus léger).
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
            <strong>720p upscalé — économe</strong>
            <br />
            <span className="avm-settings-muted">
              Rendu interne ≈720p puis upscale GPU vers l'écran : charge processeur
              réduite, utile sur une machine modeste ou pour de la 4K.
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
            <strong>1080p natif — qualité maximale</strong>
            <br />
            <span className="avm-settings-muted">
              Rendu interne 1080p : image la plus nette, lecture stable. Si la machine
              ne suit pas, l'application baisse automatiquement la résolution de rendu.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}