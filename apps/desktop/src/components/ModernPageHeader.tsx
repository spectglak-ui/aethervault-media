import type { CSSProperties, ReactNode } from "react";
import "./modern-page.css";

interface ModernPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Icône de l'emblème (lucide, ~26 px). */
  icon: ReactNode;
  /** Couleur d'accent au format « r, g, b » (voir `tintFor` / `PAGE_TINTS`). */
  tint: string;
  /** Petite étiquette au-dessus du titre (« Catalogue », « Réglages »…). */
  kicker?: string;
}

/**
 * Couleurs d'accent des pages hors catégories (même palette que les
 * portails de l'accueil ; les catégories passent par `tintFor`).
 */
export const PAGE_TINTS = {
  settings: "148, 163, 184",
  profiles: "124, 92, 255",
  stats: "245, 158, 11",
  share: "56, 189, 248",
  collections: "168, 85, 247",
  explore: "46, 196, 182",
} as const;

/**
 * En-tête des pages « modernisées » (même langage que l'accueil et la
 * page de transition AetherFy). Remplace `PageHeader` de l'ui-kit sur ces
 * pages seulement — les autres pages gardent l'en-tête d'origine. Sa
 * simple présence active aussi le style moderne du corps de la page
 * (voir `modern-page.css`, portée `:has(.avm-hxp-header)`).
 */
export function ModernPageHeader({
  title,
  description,
  actions,
  icon,
  tint,
  kicker,
}: ModernPageHeaderProps) {
  return (
    <header className="avm-hxp-header" style={{ "--tint": tint } as CSSProperties}>
      <div className="avm-hxp-header__emblem" aria-hidden="true">
        {icon}
      </div>
      <div className="avm-hxp-header__text">
        {kicker && <span className="avm-hxp-header__kicker">{kicker}</span>}
        <h1 className="avm-hxp-header__title">{title}</h1>
        {description && <p className="avm-hxp-header__desc">{description}</p>}
      </div>
      {actions && <div className="avm-hxp-header__actions">{actions}</div>}
    </header>
  );
}
