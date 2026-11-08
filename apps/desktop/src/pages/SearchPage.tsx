import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search as SearchIcon, SlidersHorizontal } from "lucide-react";
import { Button, EmptyState } from "@aethervault/ui-kit";
import type { TitleSearchQuery, TitleSearchResult } from "@aethervault/shared-types";
import { ModernPageHeader, PAGE_TINTS } from "../components/ModernPageHeader";
import { titleApi } from "../features/title/api";
import { assetUrl } from "../lib/assetUrl";
import { ActiveFilterChips, TitleFilters } from "../features/search/TitleFilters";
import { useFacetCounts } from "../features/search/useFacetCounts";
import {
  countActiveFilters,
  emptyQuery,
  isQueryActive,
  paramsToQuery,
  queryToParams,
} from "../features/search/queryParams";
import "../features/search/search.css";
import "./pages.css";

const CURRENT_YEAR = new Date().getFullYear();

/** Presets « envie du moment » en un clic, construits sur les mêmes critères. */
const MOOD_CHIPS: Array<{ label: string; patch: Partial<TitleSearchQuery> }> = [
  { label: "🍿 Sorties récentes", patch: { year_from: CURRENT_YEAR - 2, year_to: null } },
  { label: "🕰️ Années 2000", patch: { year_from: 2000, year_to: 2009 } },
  { label: "📼 Années 90", patch: { year_from: 1990, year_to: 1999 } },
  { label: "🎬 Un film", patch: { kinds: ["movie"] } },
  { label: "📺 Une série", patch: { kinds: ["series"] } },
];

/**
 * Page de résultats de la recherche avancée. Elle remplace l'ancienne page
 * « Explorer » : on y arrive depuis la barre de recherche globale (texte +
 * filtres), tout l'état vit dans l'URL (`/search?q=…&genre=…&from=…`) —
 * donc partageable, rechargeable et compatible avec Précédent/Suivant.
 */
export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = useMemo(() => paramsToQuery(searchParams), [searchParams]);
  const [text, setText] = useState(query.q ?? "");
  const [results, setResults] = useState<TitleSearchResult[] | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const facets = useFacetCounts([], true);
  const active = isQueryActive(query);
  const activeFilters = countActiveFilters(query);

  const update = (patch: Partial<TitleSearchQuery>) =>
    setSearchParams(queryToParams({ ...query, ...patch }), { replace: true });

  // La barre du haut arrive ici avec ?q=… : on resynchronise le champ texte.
  useEffect(() => {
    setText(query.q ?? "");
  }, [query.q]);

  // Saisie → URL, débouncée.
  useEffect(() => {
    if (text === (query.q ?? "")) return;
    const timeout = window.setTimeout(() => update({ q: text }), 250);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    if (!active) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      titleApi
        .search(query)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, active]);

  const reset = () => setSearchParams(queryToParams(emptyQuery(query.q ?? "")), { replace: true });
  const moodActive = (patch: Partial<TitleSearchQuery>) =>
    queryToParams({ ...emptyQuery(query.q ?? ""), ...patch }).toString() === searchParams.toString();

  return (
    <div>
      <ModernPageHeader
        icon={<SearchIcon size={26} />}
        tint={PAGE_TINTS.explore}
        kicker="Recherche"
        title="Recherche avancée"
        description="Cherchez dans Films, Séries, Animés et Documentaires, puis affinez : genre, année, acteur, réalisateur, saga, qualité…"
        actions={
          <Button variant="ghost" onClick={() => setFiltersOpen((open) => !open)}>
            <span className="avm-filters-toggle">
              <SlidersHorizontal size={16} /> Filtres
              {activeFilters > 0 && <span className="avm-filters-toggle__badge">{activeFilters}</span>}
            </span>
          </Button>
        }
      />
      <div className="avm-explore-moods">
        {MOOD_CHIPS.map((chip) => (
          <button
            key={chip.label}
            className={moodActive(chip.patch) ? "avm-chip avm-chip--active" : "avm-chip"}
            onClick={() =>
              setSearchParams(queryToParams({ ...emptyQuery(query.q ?? ""), ...chip.patch }), {
                replace: true,
              })
            }
          >
            {chip.label}
          </button>
        ))}
      </div>
      <div className="avm-explore-bar">
        <input
          type="search"
          className="avm-explore-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Titre, acteur, réalisateur, saga…"
          aria-label="Rechercher dans le catalogue"
          autoFocus
        />
      </div>
      <ActiveFilterChips query={query} onChange={update} />

      <div className={`avm-filtered-layout${filtersOpen ? " avm-filtered-layout--open" : ""}`}>
        {filtersOpen && (
          <aside className="avm-filtered-layout__filters">
            <TitleFilters query={query} onChange={update} onReset={reset} facets={facets} />
          </aside>
        )}
        <div>
          {active && results !== null && (
            <p className="avm-results-count">
              <strong>{results.length}</strong> résultat{results.length > 1 ? "s" : ""}
            </p>
          )}
          {!active && (
            <EmptyState
              icon={<SearchIcon size={32} />}
              title="Recherchez dans votre catalogue"
              description="Tapez un titre, un acteur, un réalisateur ou une saga, ou utilisez les filtres : type de média, genre, année, résolution, codec, langue…"
            />
          )}
          {active && results !== null && results.length === 0 && (
            <EmptyState
              title="Aucun résultat"
              description="Essayez d'élargir la recherche ou de retirer des filtres."
            />
          )}
          {active && results !== null && results.length > 0 && (
            <div className="avm-category-grid avm-category-grid--posters">
              {results.map((result) => (
                <button
                  key={`${result.category_key}-${result.id}`}
                  className="avm-explore-card"
                  onClick={() => navigate(`/category/${result.category_key}/title/${result.id}`)}
                >
                  {result.poster ? (
                    <img src={assetUrl(result.poster)} alt="" />
                  ) : (
                    <div className="avm-card__placeholder" aria-hidden="true" />
                  )}
                  <span className="avm-explore-card__name">{result.name}</span>
                  <span className="avm-card__subtitle">
                    {[
                      result.year !== null ? String(result.year) : null,
                      result.category_name,
                      result.kind === "movie" ? "Film" : "Série",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
