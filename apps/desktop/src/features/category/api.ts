import { invoke } from "@tauri-apps/api/core";
import type { Category } from "@aethervault/shared-types";

/**
 * Point d'accès unique aux commandes backend liées aux catégories (doc
 * §6.1). Les pages n'appellent jamais `invoke` directement.
 */
export const categoryApi = {
  list: () => invoke<Category[]>("list_categories"),

  /** Ouvre le sélecteur de fichier natif filtré sur les images — partagé
   * avec la personnalisation des Titres (`titleApi`). */
  pickImage: () => invoke<string | null>("pick_image"),

  /** `sourcePath` à `null` efface la personnalisation (doc §6.6). */
  setBanner: (categoryId: number, sourcePath: string | null) =>
    invoke<void>("set_category_banner", { categoryId, sourcePath }),
};
