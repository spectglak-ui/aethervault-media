import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Star } from "lucide-react";
import "./StarRating.css";

interface StarRatingProps {
  /** Note courante (0,5 à 5 par pas de 0,5) ; `null` = pas de note. */
  value: number | null;
  /** Absent = affichage seul. `null` = retirer la note. */
  onChange?: (value: number | null) => void;
  /** Taille d'une étoile en pixels. */
  size?: number;
  /** Affiche la valeur numérique à droite des étoiles. */
  showValue?: boolean;
  label?: string;
}

/**
 * Note en étoiles avec demi-étoiles : chaque étoile se clique par moitiés
 * (moitié gauche = x,5 ; moitié droite = x entier). Recliquer sur la note
 * courante la retire. Au clavier : flèches ±0,5, chiffres 1–5, Suppr/Retour
 * arrière pour retirer.
 */
export function StarRating({
  value,
  onChange,
  size = 20,
  showValue = false,
  label = "Ma note",
}: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const interactive = onChange !== undefined;
  const shown = hover ?? value ?? 0;

  const commit = (next: number) => onChange?.(next === value ? null : next);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onChange) return;
    const current = value ?? 0;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      onChange(Math.min(5, current + 0.5));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      onChange(current - 0.5 < 0.5 ? null : current - 0.5);
    } else if (/^[1-5]$/.test(event.key)) {
      onChange(Number(event.key));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      onChange(null);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div
      className={`avm-stars${interactive ? " avm-stars--interactive" : ""}`}
      role={interactive ? "slider" : "img"}
      aria-label={label}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 5 : undefined}
      aria-valuenow={interactive ? (value ?? 0) : undefined}
      aria-valuetext={value ? `${value} sur 5` : "Pas de note"}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      onMouseLeave={interactive ? () => setHover(null) : undefined}
      style={{ ["--star-size" as string]: `${size}px` }}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = shown >= i ? 100 : shown >= i - 0.5 ? 50 : 0;
        return (
          <span key={i} className="avm-stars__star">
            <Star size={size} className="avm-stars__empty" aria-hidden="true" />
            {fill > 0 && (
              <span className="avm-stars__fill" style={{ width: `${fill}%` }}>
                <Star size={size} className="avm-stars__full" aria-hidden="true" />
              </span>
            )}
            {interactive && (
              <>
                <span
                  className="avm-stars__half avm-stars__half--left"
                  onMouseEnter={() => setHover(i - 0.5)}
                  onClick={() => commit(i - 0.5)}
                />
                <span
                  className="avm-stars__half avm-stars__half--right"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => commit(i)}
                />
              </>
            )}
          </span>
        );
      })}
      {showValue && (
        <span className="avm-stars__value">{value ? value.toFixed(1) : "—"}</span>
      )}
    </div>
  );
}
