interface SliderProps {
  value: number;
  min?: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}

/**
 * Curseur générique (défilement, volume, et tout futur réglage — ex. délai
 * de sous-titres à l'Étape 3b). Enveloppe un `<input type="range">` natif
 * plutôt qu'un composant "drag" fait main : moins de code, comportement
 * clavier/accessibilité déjà correct par défaut.
 */
export function Slider({ value, min = 0, max, step = 0.1, onChange, ariaLabel }: SliderProps) {
  return (
    <input
      type="range"
      className="avm-slider"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      aria-label={ariaLabel}
    />
  );
}
