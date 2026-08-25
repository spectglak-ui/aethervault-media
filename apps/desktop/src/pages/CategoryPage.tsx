import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { CheckSquare, FolderPlus, RefreshCw, Square, Trash2, X } from "lucide-react";
import { Button, Card, EmptyState, Modal, PageHeader } from "@aethervault/ui-kit";
import type { Category, Library, TitleSummary } from "@aethervault/shared-types";
import { categoryApi } from "../features/category/api";
import { titleApi } from "../features/title/api";
import { libraryApi } from "../features/library/api";
import { CreateLibraryModal } from "../features/library/CreateLibraryModal";
import { PersonalizableImage } from "../features/personalization/PersonalizableImage";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/**
 * Grille des Titres d'une catégorie (doc §6.3) — le niveau "Films",
 * "Séries", "Anime" ou "Documentaires" de la navigation (§6.7). Plusieurs
 * bibliothèques peuvent alimenter la même catégorie (doc §6.1) : cette
 * page les agrège en une seule liste de Titres, sans jamais demander à
 * l'utilisateur de choisir une bibliothèque au préalable — c'est
 * précisément ce que permet le modèle Catégorie plutôt que l'ancien
 * `media_type` par bibliothèque.
 */
export function CategoryPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();

  const [category, setCategory] = useState<Category | null | undefined>(undefined);
  const [titles, setTitles] = useState<TitleSummary[] | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TitleSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    categoryApi.list().then((categories) => {
      const found = categories.find((candidate) => candidate.key === key) ?? null;
      setCategory(found);

      if (found) {
        titleApi
          .listByCategory(found.id)
          .then(setTitles)
          .catch(() => setTitles([]));
      }
    });

    libraryApi
      .list()
      .then((all) => setLibraries(all.filter((lib) => lib.category_id !== null)))
      .catch(() => setLibraries([]));
  }, [key]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkError(null);
  }, [key]);

  // Le Metadata Service tourne en tâche de fond juste après chaque scan
  // (voir commands::library::trigger_scan côté Rust) : ces deux événements
  // suffisent à garder la grille à jour sans action manuelle.
  useEffect(() => {
    const unlistenScan = listen("library:scan-complete", () => refresh());
    const unlistenMatch = listen("library:metadata-matched", () => refresh());
    return () => {
      unlistenScan.then((stop) => stop());
      unlistenMatch.then((stop) => stop());
    };
  }, [refresh]);

  const handleDeleteTitle = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await titleApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => !prev);
    setSelectedIds(new Set());
    setBulkError(null);
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allSelected = (titles?.length ?? 0) > 0 && selectedIds.size === titles?.length;

  const toggleSelectAll = () => {
    if (!titles) return;
    setSelectedIds(allSelected ? new Set() : new Set(titles.map((title) => title.id)));
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => titleApi.remove(id)));
    const failedCount = results.filter((result) => result.status === "rejected").length;

    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    setSelectionMode(false);
    setSelectedIds(new Set());
    refresh();

    setBulkError(
      failedCount > 0 ? `${failedCount} suppression(s) sur ${ids.length} ont échoué.` : null
    );
  };

  if (category === undefined) {
    return <p>Chargement…</p>;
  }

  if (category === null) {
    return (
      <EmptyState
        title="Catégorie introuvable"
        description="Cette catégorie n'existe pas ou plus."
      />
    );
  }

  const categoryLibraries = libraries.filter((lib) => lib.category_id === category.id);

  return (
    <div>
      <div className="avm-category-page__banner-wrap">
        <PersonalizableImage
          src={assetUrl(category.banner)}
          alt=""
          variant="banner"
          isCustom={category.banner_is_custom}
          onPick={async (sourcePath) => {
            await categoryApi.setBanner(category.id, sourcePath);
            refresh();
          }}
          onReset={async () => {
            await categoryApi.setBanner(category.id, null);
            refresh();
          }}
        />
      </div>

      <PageHeader
        title={`${category.icon ?? ""} ${category.name}`.trim()}
        description={
          categoryLibraries.length > 0
            ? `${categoryLibraries.length} bibliothèque(s) — ${titles?.length ?? 0} titre(s)`
            : "Aucune bibliothèque pour cette catégorie pour l'instant."
        }
        actions={
          selectionMode ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={toggleSelectAll}>
                {allSelected ? (
                  <CheckSquare size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                ) : (
                  <Square size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                )}
                {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
              </Button>
              <Button
                variant="danger"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={selectedIds.size === 0}
              >
                <Trash2 size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                Supprimer ({selectedIds.size})
              </Button>
              <Button variant="ghost" onClick={toggleSelectionMode}>
                <X size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                Annuler
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              {titles !== null && titles.length > 0 && (
                <Button variant="secondary" onClick={toggleSelectionMode}>
                  <CheckSquare size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                  Sélectionner
                </Button>
              )}
              <Button variant="primary" onClick={() => setModalOpen(true)}>
                <FolderPlus size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                Ajouter une bibliothèque
              </Button>
            </div>
          )
        }
      />

      {bulkError && <p className="avm-settings-error">{bulkError}</p>}

      {titles !== null && titles.length === 0 && (
        <EmptyState
          title="Aucun titre pour l'instant"
          description="Ajoutez une bibliothèque et lancez un scan pour commencer à remplir cette catégorie."
        />
      )}

      {titles !== null && titles.length > 0 && (
        <div className="avm-category-grid avm-category-grid--posters">
          {titles.map((title) => (
            <Card
              key={title.id}
              title={title.name}
              subtitle={title.year ? String(title.year) : undefined}
              image={assetUrl(title.poster)}
              onClick={
                selectionMode ? undefined : () => navigate(`/category/${category.key}/title/${title.id}`)
              }
              selectable={selectionMode}
              selected={selectedIds.has(title.id)}
              onToggleSelect={() => toggleSelected(title.id)}
              onDelete={
                selectionMode
                  ? undefined
                  : () => {
                      setDeleteError(null);
                      setDeleteTarget(title);
                    }
              }
              deleteLabel={`Supprimer « ${title.name} »`}
            />
          ))}
        </div>
      )}

      {categoryLibraries.length > 0 && (
        <section className="avm-category-libraries">
          <h2>Bibliothèques</h2>
          <ul className="avm-media-list">
            {categoryLibraries.map((lib) => (
              <li key={lib.id} className="avm-media-list__item">
                <span>{lib.name}</span>
                <div className="avm-media-list__badges">
                  <Button variant="ghost" onClick={() => libraryApi.scan(lib.id)}>
                    <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                    Scanner
                  </Button>
                  <Button variant="ghost" onClick={() => navigate(`/libraries/${lib.id}`)}>
                    Gérer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Supprimer « ${deleteTarget?.name ?? ""} » ?`}
      >
        <p>
          Ce Titre sera retiré d'AetherVault Media, ainsi que ses Saisons/Épisodes le cas échéant.{" "}
          <strong>Les fichiers présents sur le disque ne seront jamais supprimés.</strong>
        </p>
        <p>
          Si une bibliothèque encore active alimente ce Titre et que vous relancez un scan sur
          elle plus tard, ce Titre peut réapparaître automatiquement.
        </p>
        {deleteError && <p className="avm-settings-error">{deleteError}</p>}
        <div className="avm-form-actions">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Annuler
          </Button>
          <Button variant="danger" onClick={handleDeleteTitle} disabled={deleting}>
            {deleting ? "Suppression…" : "Supprimer définitivement"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Supprimer ${selectedIds.size} titre(s) ?`}
      >
        <p>
          Ces Titres seront retirés d'AetherVault Media, ainsi que leurs Saisons/Épisodes le cas
          échéant. <strong>Les fichiers présents sur le disque ne seront jamais supprimés.</strong>
        </p>
        <p>
          Pour un Titre dont la bibliothèque source est toujours active, un futur scan de cette
          bibliothèque peut le faire réapparaître automatiquement.
        </p>
        <div className="avm-form-actions">
          <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>
            Annuler
          </Button>
          <Button variant="danger" onClick={handleBulkDelete} disabled={bulkDeleting}>
            {bulkDeleting ? "Suppression…" : "Supprimer définitivement"}
          </Button>
        </div>
      </Modal>

      <CreateLibraryModal
        open={modalOpen}
        categoryId={category.id}
        onClose={() => setModalOpen(false)}
        onCreated={refresh}
      />
    </div>
  );
}
