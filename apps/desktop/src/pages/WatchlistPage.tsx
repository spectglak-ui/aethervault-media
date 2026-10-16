import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, X } from "lucide-react";
import { EmptyState, IconButton } from "@aethervault/ui-kit";
import type { Category } from "@aethervault/shared-types";
import { ModernPageHeader, PAGE_TINTS } from "../components/ModernPageHeader";
import { StarRating } from "../components/StarRating";
import { categoryApi } from "../features/category/api";
import {
  userListsApi,
  WATCH_STATUS_LABELS,
  type WatchStatus,
  type WatchlistEntry,
} from "../features/userlists/api";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

type StatusFilter = "all" | WatchStatus;
type SortKey = "added" | "rating" | "name";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "todo", label: WATCH_STATUS_LABELS.todo },
  { key: "in_progress", label: WATCH_STATUS_LABELS.in_progress },
  { key: "done", label: WATCH_STATUS_LABELS.done },
];

const SORT_LABELS: Record<SortKey, string> = {
  added: "Ajout récent",
  rating: "Ma note",
  name: "Titre (A → Z)",
};

/**
 * Watchlist du profil actif : titres « à voir », « en cours » et « vus »,
 * filtrables par statut et par catégorie, triables par date d'ajout, note ou
 * titre. Distincte des Collections (listes libres et globales). On y change le
 * statut et la note directement depuis chaque affiche.
 */
export function WatchlistPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<WatchlistEntry[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("added");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    userListsApi
      .watchlistList()
      .then((rows) => {
        setEntries(rows);
        setError(null);
      })
      .catch((err) => {
        setEntries([]);
        setError(typeof err === "string" ? err : "Chargement impossible.");
      });
  }, []);

  useEffect(() => {
    refresh();
    categoryApi.list().then(setCategories).catch(() => {});
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      refresh();
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "Échec.");
    }
  };

  // Catégories réellement présentes dans la watchlist (le filtre n'offre pas de choix vides).
  const presentCategories = useMemo(() => {
    const ids = new Set((entries ?? []).map((e) => e.title.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [entries, categories]);

  const inCategory = useMemo(
    () => (entries ?? []).filter((e) => categoryId === null || e.title.category_id === categoryId),
    [entries, categoryId]
  );

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: inCategory.length, todo: 0, in_progress: 0, done: 0 };
    for (const e of inCategory) c[e.status] += 1;
    return c;
  }, [inCategory]);

  const visible = useMemo(() => {
    const list = inCategory.filter((e) => status === "all" || e.status === status);
    const copy = [...list];
    if (sort === "rating") {
      // Les titres non notés passent après les notés.
      copy.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.name.localeCompare(b.title.name));
    } else if (sort === "name") {
      copy.sort((a, b) => a.title.name.localeCompare(b.title.name, "fr"));
    }
    return copy; // « added » : ordre renvoyé par le backend (ajout le plus récent d'abord)
  }, [inCategory, status, sort]);

  const openTitle = (entry: WatchlistEntry) => {
    const category = categories.find((c) => c.id === entry.title.category_id);
    if (category) navigate(`/category/${category.key}/title/${entry.title.id}`);
  };

  return (
    <div>
      <ModernPageHeader
        icon={<Bookmark size={26} />}
        tint={PAGE_TINTS.watchlist}
        kicker="Votre liste"
        title="Watchlist"
        description="Ce que vous voulez voir, ce que vous regardez, et ce que vous avez vu — avec votre note."
      />

      <div className="avm-watchlist__bar">
        <div className="avm-watchlist__tabs" role="tablist" aria-label="Statut">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              className={`avm-watchlist__tab${status === t.key ? " avm-watchlist__tab--active" : ""}`}
              onClick={() => setStatus(t.key)}
            >
              {t.label} <span className="avm-watchlist__count">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="avm-watchlist__filters">
          <label>
            Catégorie{" "}
            <select
              className="avm-user-panel__select"
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">Toutes</option>
              {presentCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trier par{" "}
            <select
              className="avm-user-panel__select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="avm-settings-error">{error}</p>}

      {entries === null ? (
        <p>Chargement…</p>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={32} />}
          title="Votre watchlist est vide"
          description="Ajoutez des titres depuis leur page (bouton « Ajouter à ma watchlist »)."
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun titre ici" description="Changez de statut ou de catégorie." />
      ) : (
        <div className="avm-category-grid avm-category-grid--posters">
          {visible.map((entry) => (
            <div key={entry.title.id} className="avm-collections__cardwrap avm-watchlist__card">
              <button className="avm-explore-card" onClick={() => openTitle(entry)}>
                {assetUrl(entry.title.poster) ? (
                  <img src={assetUrl(entry.title.poster)} alt="" loading="lazy" />
                ) : (
                  <div className="avm-card__placeholder" aria-hidden="true" />
                )}
                <span className="avm-explore-card__name">{entry.title.name}</span>
              </button>
              <IconButton
                label="Retirer de la watchlist"
                onClick={() => void run(() => userListsApi.watchlistRemove(entry.title.id))}
              >
                <X size={14} />
              </IconButton>
              <div className="avm-watchlist__controls">
                <select
                  className="avm-user-panel__select"
                  aria-label={`Statut de ${entry.title.name}`}
                  value={entry.status}
                  onChange={(e) =>
                    void run(() =>
                      userListsApi.watchlistSetStatus(entry.title.id, e.target.value as WatchStatus)
                    )
                  }
                >
                  {(Object.keys(WATCH_STATUS_LABELS) as WatchStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {WATCH_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <StarRating
                  value={entry.rating}
                  size={16}
                  label={`Ma note pour ${entry.title.name}`}
                  onChange={(next) => void run(() => userListsApi.setRating(entry.title.id, next))}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
