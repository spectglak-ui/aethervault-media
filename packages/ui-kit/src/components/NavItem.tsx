import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface NavItemProps {
  icon: ReactNode;
  /** FONCTIONNALITÉ : élargi de `string` à `ReactNode` pour permettre un
   * libellé partiellement stylisé (ex. un mot dans une police dédiée),
   * en restant rétrocompatible — une simple chaîne reste un `ReactNode`
   * valide, tous les usages existants continuent de fonctionner tels
   * quels. */
  label: ReactNode;
  /** Texte pour l'infobulle en mode réduit, utile quand `label` n'est
   * pas une simple chaîne (l'attribut HTML `title` n'accepte pas de
   * JSX). Si omis et que `label` est une chaîne, celle-ci est réutilisée
   * automatiquement — aucun changement pour les usages existants. */
  titleText?: string;
  active?: boolean;
  /** Masque visuellement le libellé (barre latérale réduite) sans le
   * retirer du DOM, pour rester accessible aux lecteurs d'écran. */
  collapsed?: boolean;
  onClick?: () => void;
}

/**
 * Composant purement présentationnel : il ne dépend d'aucun routeur.
 * L'appelant (`apps/desktop/src/layout/Sidebar.tsx`) calcule lui-même
 * l'état actif via son routeur et passe `active`/`onClick` en conséquence —
 * ui-kit reste ainsi réutilisable indépendamment du choix de routage.
 *
 * La pastille active utilise `layoutId` de framer-motion : quand `active`
 * change d'élément, la pastille glisse d'une position à l'autre au lieu de
 * disparaître/réapparaître, un détail "premium" à moindre coût car partagé
 * par tous les usages de `NavItem`.
 */
export function NavItem({ icon, label, titleText, active, collapsed, onClick }: NavItemProps) {
  const resolvedTitle = titleText ?? (typeof label === "string" ? label : undefined);
  return (
    <button
      type="button"
      className={["avm-nav-item", active ? "avm-nav-item--active" : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? resolvedTitle : undefined}
    >
      {active && (
        <motion.span
          layoutId="avm-nav-item-active-pill"
          className="avm-nav-item__pill"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <span className="avm-nav-item__icon">{icon}</span>
      <span
        className={["avm-nav-item__label", collapsed ? "avm-visually-hidden" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {label}
      </span>
    </button>
  );
}
