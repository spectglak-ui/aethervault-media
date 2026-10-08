import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * Panneau de contrôle "Lumière ambiante" affiché au survol du player.
 * Contrôle le halo cinématique qui entoure le player (flou + propagation).
 */
export interface AmbientSettings {
  enabled: boolean;
  blur: number;      // 0-100 (rayon de flou en %)
  spread: number;    // 0-200 (propagation du halo en %)
}

const DEFAULT_SETTINGS: AmbientSettings = {
  enabled: true,
  blur: 60,
  spread: 130,
};

const STORAGE_KEY = "afy-ambient-settings";

export function useAmbientSettings() {
  const [settings, setSettings] = useState<AmbientSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } catch {}
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  return [settings, setSettings] as const;
}

interface Props {
  settings: AmbientSettings;
  onChange: (next: AmbientSettings) => void;
  /** Force l'affichage (ex. bouton cliqué) */
  forceShow?: boolean;
}

export function AetherFyAmbientLight({ settings, onChange, forceShow }: Props) {
  return (
    <div className={`afy-ambient-panel${forceShow ? " afy-ambient-panel--force-show" : ""}`}>
      <div className="afy-ambient-panel__head">
        <Sparkles size={14} color="#ff9f1c" />
        <span className="afy-ambient-panel__title">Lumière ambiante</span>
      </div>

      <div className="afy-ambient-panel__row">
        <div className="afy-ambient-panel__label">
          <span>Flou</span>
          <span className="afy-ambient-panel__value">{settings.blur}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.blur}
          onChange={(e) =>
            onChange({ ...settings, blur: Number(e.target.value) })
          }
          className="afy-ambient-panel__slider"
        />
      </div>

      <div className="afy-ambient-panel__row">
        <div className="afy-ambient-panel__label">
          <span>Propagation</span>
          <span className="afy-ambient-panel__value">{settings.spread}%</span>
        </div>
        <input
          type="range"
          min={50}
          max={200}
          value={settings.spread}
          onChange={(e) =>
            onChange({ ...settings, spread: Number(e.target.value) })
          }
          className="afy-ambient-panel__slider"
        />
      </div>

      <div className="afy-ambient-panel__row">
        <button
          type="button"
          className={`afy-ambient-toggle${!settings.enabled ? " afy-ambient-toggle--off" : ""}`}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
        >
          <span>{settings.enabled ? "Activé" : "Désactivé"}</span>
          <span className="afy-ambient-toggle__knob" />
        </button>
      </div>
    </div>
  );
}