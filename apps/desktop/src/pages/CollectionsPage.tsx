import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderHeart, Plus, Trash2, X } from "lucide-react";
import { Button, EmptyState, IconButton, PageHeader } from "@aethervault/ui-kit";
import type { Category, TitleSummary } from "@aethervault/shared-types";
import { titleApi, type CollectionRecord } from "../features/title/api";
import { categoryApi } from "../features/category/api";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/**
 * Collections utilisateur (Étape 8) : listes personnalisées
 * (« À voir », « Favoris »…). Création/suppression à gauche, grille des
 * titres à droite ; l'ajout se fait depuis la page Titre (menu ListPlus),
 * le retrait depuis la petite croix sur chaque affiche.
 */
export function CollectionsPage() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<CollectionRecord[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [titles, setTitles] = useState<TitleSummary[] | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const refreshCollections = useCallback(() => {
    titleApi.listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  useEffect(() => {
    refreshCollections();
    categoryApi.list().then(setCategories).catch(() => {});
  }, [refreshCollections]);

  useEffect(() => {
    if (selectedId === null) {
      setTitles(null);
      return;
    }
    setTitles(null);
    titleApi
      .listCollectionTitles(selectedId)
      .then(setTitles)
      .catch(() => setTitles([]));
  }, [selectedId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const id = await titleApi.createCollection(name);
      setNewName("");
      refreshCollections();
      setSelectedId(id);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (collection: CollectionRecord) => {
    if (!window.confirm(`Supprimer la collection « ${collection.name} » ?`)) return;
    await titleApi.deleteCollection(collection.id);
    if (selectedId === collection.id) setSelectedId(null);
    refreshCollections();
  };

  const handleRemove = (titleId: number) => {
    if (selectedId === null) return;
    void titleApi.removeFromCollection(selectedId, titleId).then(() => {
      titleApi.listCollectionTitles(selectedId).then(setTitles).catch(() => {});
      refreshCollections();
    });
  };

  const openTitle = (title: TitleSummary) => {
    const category = categories.find((c) => c.id === title.category_id);
    if (category) navigate(`/category/${category.key}/title/${title.id}`);
  };

  const selected = collections?.find((c) => c.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Collections"
        description="Vos listes personnalisées : à voir, favoris, sagas…"
      />
      <div className="avm-collections">
        <aside className="avm-collections__side">
          <div className="avm-collections__create">
            <input
              className="avm-collections__input"
              placeholder="Nouvelle collection…"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleCreate();
              }}
            />
            <Button
              variant="primary"
              onClick={() => void handleCreate()}
              disabled={creating || newName.trim().length === 0}
            >
              <Plus size={14} />
            </Button>
          </div>
          {collections === null ? (
            <p>Chargement…</p>
          ) : collections.length === 0 ? (
            <p className="avm-settings-muted">Aucune collection pour l'instant.</p>
          ) : (
            <ul className="avm-collections__list">
              {collections.map((collection) => (
                <li
                  key={collection.id}
                  className={selectedId === collection.id ? "avm-collections__active" : ""}
                >
                  <button
                    className="avm-collections__item"
                    onClick={() => setSelectedId(collection.id)}
                  >
                    <FolderHeart size={14} />
                    <span>{collection.name}</span>
                    <span className="avm-collections__count">{collection.count}</span>
                  </button>
                  <IconButton
                    label={`Supprimer ${collection.name}`}
                    onClick={() => void handleDelete(collection)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="avm-collections__content">
          {selected === null ? (
            <EmptyState
              icon={<FolderHeart size={32} />}
              title="Sélectionnez une collection"
              description="Ou créez-en une nouvelle ci-contre."
            />
          ) : titles === null ? (
            <p>Chargement…</p>
          ) : titles.length === 0 ? (
            <EmptyState
              title="Collection vide"
              description="Ajoutez des titres depuis leur page (bouton « Ajouter à une collection »)."
            />
          ) : (
            <div className="avm-category-grid avm-category-grid--posters">
              {titles.map((title) => (
                <div key={title.id} className="avm-collections__cardwrap">
                  <button className="avm-explore-card" onClick={() => openTitle(title)}>
                    {assetUrl(title.poster) ? (
                      <img src={assetUrl(title.poster)} alt="" />
                    ) : (
                      <div className="avm-card__placeholder" aria-hidden="true" />
                    )}
                    <span className="avm-explore-card__name">{title.name}</span>
                  </button>
                  <IconButton label="Retirer de la collection" onClick={() => handleRemove(title.id)}>
                    <X size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}