import type { ComponentType } from "react";
import { Clapperboard, Tv, Sparkles, BookOpen, Video, FolderOpen, type LucideProps } from "lucide-react";

/**
 * Depuis l'Étape 4, le "type" d'une bibliothèque n'existe plus : elle est
 * rattachée à une Catégorie (doc §6.1), dont l'icône est un simple emoji
 * fourni par le backend (`Category.icon`) et affiché tel quel — plus
 * besoin d'un registre de composants Lucide pour ça (voir `CategoryTile`).
 *
 * `getLibraryIcon` reste utile indépendamment : une bibliothèque garde son
 * propre champ `icon` (texte libre, nom d'icône Lucide) pour la
 * distinguer visuellement des autres bibliothèques d'une même catégorie
 * dans les vues d'administration (`LibraryPage`) — un usage différent de
 * l'ancien "icône par type", conservé ici plutôt que dupliqué.
 */
const ICON_BY_NAME: Record<string, ComponentType<LucideProps>> = {
  Clapperboard,
  Tv,
  Sparkles,
  BookOpen,
  Video,
  FolderOpen,
};

/** Retrouve le composant icône à partir du nom stocké en base (`icon`). */
export function getLibraryIcon(iconName: string | null): ComponentType<LucideProps> {
  if (iconName && iconName in ICON_BY_NAME) {
    return ICON_BY_NAME[iconName];
  }
  return FolderOpen;
}
