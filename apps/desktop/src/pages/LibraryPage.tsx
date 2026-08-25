import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { Library as LibraryIcon } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@aethervault/ui-kit";
import type { Category, Library } from "@aethervault/shared-types";
import { libraryApi } from "../features/library/api";
import { categoryApi } from "../features/category/api";
import { getLibraryIcon } from "../features/library/mediaTypePresets";
import "./pages.css";

/**
 * Vue d'administration transverse (toutes bibliothèques, toutes
 * catégories confondues) — utile pour la maintenance (dossiers,
 * disponibilité, scan manuel), mais plus le point d'entrée principal de
 * navigation depuis l'Étape 4 : celui-ci est désormais l'Accueil (tuiles
 * de catégories, doc §6.7). La création d'une bibliothèque se fait
 * depuis une `CategoryPage` précise (la catégorie de destination y est
 * déjà déterminée par le contexte), plus depuis cette page.
 */
export function LibraryPage() {
  const navigate = useNavigate();
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const refresh = useCallback(() => {
    libraryApi
      .list()
      .then(setLibraries)
      .catch(() => setLibraries([]));
    categoryApi
      .list()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Émis par le Filesystem Watcher (Étape 2b) dès qu'un fichier est ajouté,
  // modifié ou supprimé dans une bibliothèque surveillée — la grille reste
  // à jour sans que l'utilisateur ait besoin de rouvrir la page.
  useEffect(() => {
    const unlisten = listen<number>("library:updated", () => refresh());
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [refresh]);

  const categoryName = (categoryId: number | null) =>
    categories.find((category) => category.id === categoryId)?.name ?? "Catégorie inconnue";

  return (
    <div>
      <PageHeader
        title="Toutes les bibliothèques"
        description="Vue d'ensemble et maintenance — pour parcourir le contenu par catégorie, utilisez l'Accueil."
      />

      {libraries === null && <p>Chargement…</p>}

      {libraries !== null && libraries.length === 0 && (
        <EmptyState
          icon={<LibraryIcon size={32} />}
          title="Aucune bibliothèque créée"
          description="Rendez-vous sur une catégorie depuis l'Accueil pour créer votre première bibliothèque."
        />
      )}

      {libraries !== null && libraries.length > 0 && (
        <div className="avm-library-grid">
          {libraries.map((lib) => {
            const Icon = getLibraryIcon(lib.icon);
            return (
              <Card
                key={lib.id}
                title={lib.name}
                subtitle={`${categoryName(lib.category_id)} · ${lib.media_count} média(s) · ${lib.folder_count} dossier(s)`}
                onClick={() => navigate(`/libraries/${lib.id}`)}
              >
                <div className="avm-card__icon-row">
                  <Icon size={18} color={lib.accent_color ?? undefined} />
                  {lib.unavailable_folder_count > 0 && (
                    <span className="avm-badge avm-badge--warning">Indisponible</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
