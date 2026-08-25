import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, PageHeader } from "@aethervault/ui-kit";
import type { Category } from "@aethervault/shared-types";
import { categoryApi } from "../features/category/api";
import { categoryRoute } from "../lib/categoryRoute";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/**
 * Porte d'entrée principale de l'application (doc §2, principe 6 ; §6.7) :
 * les grandes catégories restent en permanence visibles et constituent le
 * cœur de la navigation — contrairement à Netflix/Plex/Jellyfin/Emby,
 * cette page ne présente jamais de média directement, uniquement les
 * catégories qui y mènent. Les futures sections dynamiques (Étape 7 :
 * Continuer la lecture, Derniers ajouts, Favoris, Recommandés) viendront
 * s'ajouter au-dessus ou en dessous de cette grille, jamais à sa place.
 *
 * La catégorie Privé (`key === "private"`) est un cas particulier : elle
 * n'affiche jamais de compteur (`title_count` vaut toujours `null` pour
 * elle côté backend, doc §6.4) et mène à un écran d'authentification
 * plutôt qu'à la liste de titres habituelle — cet écran lui-même arrive à
 * l'Étape 6, cette tuile reste donc pour l'instant un simple repère
 * visuel de la structure finale plutôt qu'une fonctionnalité complète.
 */
export function HomePage() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[] | null>(null);

  const refresh = useCallback(() => {
    categoryApi
      .list()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCategory = (category: Category) => navigate(categoryRoute(category));

  return (
    <div>
      <PageHeader
        title="Accueil"
        description="Toute votre médiathèque, organisée par catégorie."
      />

      {categories === null && <p>Chargement…</p>}

      {categories !== null && (
        <div className="avm-category-grid">
          {categories.map((category) => (
            <Card
              key={category.id}
              title={category.name}
              subtitle={
                category.title_count !== null
                  ? `${category.title_count} titre(s)`
                  : undefined
              }
              image={assetUrl(category.banner)}
              onClick={() => openCategory(category)}
            >
              <div className="avm-card__icon-row">
                <span className="avm-category-tile__icon" aria-hidden="true">
                  {category.icon}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
