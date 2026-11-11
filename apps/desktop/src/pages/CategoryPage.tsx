import { useCategoryBackdropHidden } from "../hooks/useCategoryBackdropHidden";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  CheckSquare,
  Dices,
  FolderPlus,
  ImageUp,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button, Card, EmptyState, IconButton, Modal } from "@aethervault/ui-kit";
import { ModernPageHeader } from "../components/ModernPageHeader";
import { categoryIcon } from "../lib/categoryIcon";
import { tintFor } from "./home/homeTheme";
import type { Category, Library, TitleSearchQuery, TitleSummary } from "@aethervault/shared-types";
import { categoryApi } from "../features/category/api";
import { titleApi } from "../features/title/api";
import { libraryApi } from "../features/library/api";
import { CreateLibraryModal } from "../features/library/CreateLibraryModal";
import { ScanProgressBar } from "../components/ScanProgressBar";
import { TitleRoulette } from "../components/TitleRoulette";
import { usePlayer } from "../player/PlayerContext";
import { assetUrl } from "../lib/assetUrl";
import { TitleUserBadges } from "../features/userlists/TitleUserBadges";
import { useTitleUserStates } from "../features/userlists/useTitleUserStates";
import { useTitleWatchStates } from "../features/watchState/useWatchStates";
import { useAnimatedBackdropActive } from "../hooks/useAnimatedBackdropActive";
import { ActiveFilterChips, TitleFilters } from "../features/search/TitleFilters";
import { useFacetCounts } from "../features/search/useFacetCounts";
import { countActiveFilters, emptyQuery, isQueryActive } from "../features/search/queryParams";
import "./pages.css";

/**
 * Grille des Titres d'une catégorie (doc §6.3) — le niveau "Films",
 * "Séries", "Anime" ou "Documentaires" de la navigation (§6.7). Plusieurs
 * bibliothèques peuvent alimenter la même catégorie (doc §6.1) : cette
 * page les agrège en une seule liste de Titres, sans jamais demander à
 * l'utilisateur de choisir une bibliothèque au préalable — c'est
 * précisément ce que permet le modèle Catégorie plutôt que l'ancien
 * `media_type` par bibliothèque.
 *
 * Étape 6d : la section « Bibliothèques » affiche une mini barre de
 * progression (`ScanProgressBar`) à côté du bouton « Scanner » de chaque
 * bibliothèque — pilotée par `library:scan-progress`, invisible au repos.
 *
 * Étape 7 (lot 4) : la petite bannière horizontale est remplacée par un
 * fond d'écran de page (bannière de la catégorie personnalisée, ou à
 * défaut affiche du premier titre, assombrie), changé/réinitialisé via
 * les deux boutons de la barre d'actions (même logique `custom_images`
 * qu'avant, seul le rendu change).
 *
 * Étape 8 : bouton « Roulette » (🎰) — tire un titre au hasard dans la
 * catégorie avec une animation de défilement de 5 s (voir
 * `TitleRoulette`), puis propose « Lecture » / « Rejouer » sans jamais
 * lancer la lecture automatiquement.
 */
export function CategoryPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  // FONCTIONNALITÉ : masque le fond statique de CETTE page quand le fond
  // animé global est actif, plutôt que de compter sur l'empilement
  // z-index (voir le hook pour le pourquoi).
  const animatedBackdropActive = useAnimatedBackdropActive();
  const hideCategoryBackdrop = useCategoryBackdropHidden();
  const [category, setCategory] = useState<Category | null | undefined>(undefined);
  const [titles, setTitles] = useState<TitleSummary[] | null>(null);
  // Notes personnelles et watchlist du profil actif, en une requête pour toute la grille.
  const userStates = useTitleUserStates(titles ? titles.map((t) => t.id) : null);
  // Statut de visionnage automatique (À voir / En cours / Vu), recalculé à chaque lecture.
  const watchStates = useTitleWatchStates(titles ? titles.map((t) => t.id) : null);
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
  const [rouletteOpen, setRouletteOpen] = useState(false);
  // Filtres de recherche de la catégorie (mêmes critères que la recherche
  // globale : genre, année, acteur, réalisateur, saga, résolution, codec,
  // langue). `filteredIds` = null tant qu'aucun filtre n'est actif.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<TitleSearchQuery>(() => emptyQuery());
  const [filteredIds, setFilteredIds] = useState<Set<number> | null>(null);
  const facets = useFacetCounts(category ? [category.key] : [], filtersOpen && !!category);
  const activeFilters = countActiveFilters(filters);
  const filtersActive = isQueryActive(filters);
  const { play } = usePlayer();

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
    setFilters(emptyQuery());
    setFilteredIds(null);
    setFiltersOpen(false);
  }, [key]);

  // Filtres actifs → le moteur de recherche renvoie les Titres de CETTE
  // catégorie qui correspondent ; la grille n'affiche que ceux-là.
  useEffect(() => {
    if (!category || !filtersActive) {
      setFilteredIds(null);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      titleApi
        .search({ ...filters, category_keys: [category.key] })
        .then((found) => {
          if (!cancelled) setFilteredIds(new Set(found.map((result) => result.id)));
        })
        .catch(() => {
          if (!cancelled) setFilteredIds(new Set());
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [category, filters, filtersActive]);

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

  // Titres réellement affichés (tous, ou ceux qui passent les filtres).
  const visibleTitles =
    titles && filteredIds ? titles.filter((title) => filteredIds.has(title.id)) : titles;

  const allSelected =
    (visibleTitles?.length ?? 0) > 0 && !!visibleTitles?.every((title) => selectedIds.has(title.id));

  const toggleSelectAll = () => {
    if (!visibleTitles) return;
    setSelectedIds(allSelected ? new Set() : new Set(visibleTitles.map((title) => title.id)));
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

  // Fond d'écran de page : bannière de la catégorie si elle existe
  // (personnalisée ou automatique), sinon repli sur l'affiche du premier
  // titre pour que la page ne reste pas nue. Retirez le `?? …` si vous
  // préférez un fond uniquement quand une bannière existe.
  const wallpaper =
    assetUrl(category.banner) ??
    assetUrl(titles && titles.length > 0 ? titles[0].poster : undefined);

  const handlePickWallpaper = async () => {
    const sourcePath = await categoryApi.pickImage();
    if (!sourcePath) return;
    await categoryApi.setBanner(category.id, sourcePath);
    refresh();
  };
  const handleResetWallpaper = async () => {
    await categoryApi.setBanner(category.id, null);
    refresh();
  };

  /** Roulette (Étape 8) : « Lecture » — film : lecture directe ; série :
   * ouvre la page du Titre pour choisir saison/épisode. */
  const handleRoulettePlay = async (title: TitleSummary) => {
    setRouletteOpen(false);
    try {
      const details = await titleApi.getDetails(title.id);
      if (details.kind === "movie" && details.media_file_id !== null) {
        const file = await libraryApi.getMediaFile(details.media_file_id);
        play({ id: file.id, title: details.name, path: file.path, libraryId: file.library_id });
        return;
      }
    } catch {
      // best-effort : repli sur la navigation classique
    }
    navigate(`/category/${category.key}/title/${title.id}`);
  };

    return (
    <div className="avm-category-page">
      {/* 0.5.4 — fond de page en couche FIXE plein-fenêtre : couvre TOUTE
          la fenêtre (derrière sidebar/barre du haut) et passe DERRIÈRE le
          contenu (z-index 0 vs 1) — indispensable au thème Transparent.
          FONCTIONNALITÉ : masqué quand le fond animé est actif, pour
          qu'il ne reste jamais visible par-dessus. */}
      {wallpaper && !animatedBackdropActive && !hideCategoryBackdrop && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <img
            src={wallpaper}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(rgba(12, 12, 16, 0.55), rgba(12, 12, 16, 0.82))",
            }}
          />
        </div>
      )}
      {/* FONCTIONNALITÉ : zIndex 1 → 3, pour laisser le fond animé global
          (z-index 1 quand actif, voir styles/global.css) passer par-dessus
          le fond statique de CETTE page (ci-dessus, resté à 0) sans jamais
          couvrir ce contenu. */}
      <div className="avm-category-page__content" style={{ position: "relative", zIndex: 3 }}>
        <ModernPageHeader
          icon={categoryIcon(category.key, 26)}
          tint={tintFor(category.key)}
          kicker="Catalogue"
          title={category.name}
          description={
            categoryLibraries.length > 0
              ? `${categoryLibraries.length} bibliothèque(s) — ${titles?.length ?? 0} titre(s)`
              : "Aucune bibliothèque pour cette catégorie pour l'instant."
          }
          actions={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {titles !== null && titles.length > 0 && (
                <Button variant="secondary" onClick={() => setFiltersOpen((open) => !open)}>
                  <span className="avm-filters-toggle">
                    <SlidersHorizontal size={14} /> Filtres
                    {activeFilters > 0 && <span className="avm-filters-toggle__badge">{activeFilters}</span>}
                  </span>
                </Button>
              )}
              {titles !== null && titles.length > 0 && (
                <IconButton
                  label="Roulette : un titre au hasard"
                  onClick={() => setRouletteOpen(true)}
                >
                  <Dices size={16} />
                </IconButton>
              )}
              <IconButton label="Changer le fond de page" onClick={() => void handlePickWallpaper()}>
                <ImageUp size={16} />
              </IconButton>
              {category.banner_is_custom && (
                <IconButton
                  label="Réinitialiser le fond automatique"
                  onClick={() => void handleResetWallpaper()}
                >
                  <RotateCcw size={16} />
                </IconButton>
              )}
              {selectionMode ? (
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
              )}
            </div>
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
          <div className={`avm-filtered-layout${filtersOpen ? " avm-filtered-layout--open" : ""}`}>
            {filtersOpen && (
              <aside className="avm-filtered-layout__filters">
                <TitleFilters
                  query={filters}
                  facets={facets}
                  showMediaType={false}
                  showTextSearch
                  textPlaceholder={`Rechercher dans ${category.name}…`}
                  onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
                  onReset={() => setFilters(emptyQuery())}
                />
              </aside>
            )}
            <div>
              {filtersActive && (
                <>
                  <ActiveFilterChips
                    query={filters}
                    showMediaType={false}
                    onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
                  />
                  <p className="avm-results-count">
                    <strong>{visibleTitles?.length ?? 0}</strong> sur {titles.length} titre
                    {titles.length > 1 ? "s" : ""}
                  </p>
                </>
              )}
              {filtersActive && visibleTitles !== null && visibleTitles.length === 0 && (
                <EmptyState
                  title="Aucun titre ne correspond"
                  description="Retirez un filtre ou réinitialisez-les pour revoir toute la catégorie."
                />
              )}
          <div className="avm-category-grid avm-category-grid--posters">
            {(visibleTitles ?? titles).map((title) => (
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
              >
                <TitleUserBadges state={userStates[title.id]} watch={watchStates[title.id]} />
              </Card>
            ))}
          </div>
            </div>
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
                    {/* Étape 6d : barre de progression du scan (invisible au
                        repos, apparaît pendant scan → appariement → vignettes
                        et disparaît au signal "done"). */}
                    <ScanProgressBar libraryId={lib.id} />
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
        {rouletteOpen && titles !== null && titles.length > 0 && (
          <TitleRoulette
            titles={titles}
            categoryName={category.name}
            onClose={() => setRouletteOpen(false)}
            onPlay={(title) => void handleRoulettePlay(title)}
          />
        )}
      </div>
    </div>
  );
}