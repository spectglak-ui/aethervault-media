import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, Trash2 } from "lucide-react";
import { IconButton } from "./IconButton";

interface CardProps {
  title: string;
  subtitle?: string;
  image?: string;
  onClick?: () => void;
  children?: ReactNode;
  /**
   * Bouton de suppression optionnel, affiché en overlay au survol —
   * n'apparaît que si cette prop est fournie, pour ne rien changer aux
   * usages existants (bibliothèques, catégories sur l'Accueil) qui n'en
   * ont pas besoin. `stopPropagation` géré ici : cliquer sur ce bouton ne
   * déclenche jamais aussi le `onClick` de la carte (navigation). Ignoré
   * tant que `selectable` est actif (une carte ne propose jamais les deux
   * affordances de suppression — unitaire et groupée — en même temps).
   */
  onDelete?: () => void;
  deleteLabel?: string;
  /**
   * Mode sélection multiple (bascule "Sélectionner" d'une grille, Étape 5).
   * Quand actif, cliquer la carte appelle `onToggleSelect` au lieu de
   * `onClick` — la navigation est suspendue tant que dure la sélection,
   * comme dans la plupart des sélecteurs de fichiers/photos.
   */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

/**
 * Carte générique pour les futures grilles de médias (bibliothèques,
 * collections, résultats de recherche — Étapes 2/4/7). Ajoutée dès
 * maintenant, avant tout usage réel : c'est exactement le genre de
 * composant qu'il vaut mieux avoir prêt plutôt que de le créer dans
 * l'urgence quand plusieurs pages en auront besoin en même temps.
 */
export function Card({
  title,
  subtitle,
  image,
  onClick,
  children,
  onDelete,
  deleteLabel = "Supprimer",
  selectable = false,
  selected = false,
  onToggleSelect,
}: CardProps) {
  const handleClick = selectable ? onToggleSelect : onClick;

  return (
    <motion.div
      className={["avm-card", handleClick && "avm-card--clickable", selected && "avm-card--selected"]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      whileHover={{ y: -4 }}
      whileTap={handleClick ? { scale: 0.98 } : undefined}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      role={selectable ? "checkbox" : handleClick ? "button" : undefined}
      aria-checked={selectable ? selected : undefined}
      tabIndex={handleClick ? 0 : undefined}
    >
      {selectable && (
        <span
          className={["avm-card__checkbox", selected && "avm-card__checkbox--checked"]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        >
          {selected && <Check size={14} />}
        </span>
      )}
      {onDelete && !selectable && (
        <IconButton
          label={deleteLabel}
          className="avm-card__delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={14} />
        </IconButton>
      )}
      <div className="avm-card__media">
        {image ? (
          <img src={image} alt="" className="avm-card__image" />
        ) : (
          <div className="avm-card__placeholder" aria-hidden="true" />
        )}
      </div>
      <div className="avm-card__body">
        <div className="avm-card__title">{title}</div>
        {subtitle && <div className="avm-card__subtitle">{subtitle}</div>}
        {children}
      </div>
    </motion.div>
  );
}
