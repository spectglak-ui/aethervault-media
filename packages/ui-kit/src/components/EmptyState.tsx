import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Utilisé par toutes les pages encore vides de contenu réel (Étape 1).
 * Volontairement honnête : chaque description renvoie vers l'étape de la
 * roadmap qui implémentera la fonctionnalité correspondante, plutôt que de
 * simuler des données factices.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="avm-empty-state">
      {icon && <div className="avm-empty-state__icon">{icon}</div>}
      <h2 className="avm-empty-state__title">{title}</h2>
      {description && (
        <p className="avm-empty-state__description">{description}</p>
      )}
      {action && <div className="avm-empty-state__action">{action}</div>}
    </div>
  );
}
