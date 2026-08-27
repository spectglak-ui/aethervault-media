import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Compass, SlidersHorizontal } from "lucide-react";
import { Button, EmptyState, PageHeader } from "@aethervault/ui-kit";
import type { Category, SearchFacets, TitleSearchQuery, TitleSearchResult } from "@aethervault/shared-types";
import { titleApi } from "../features/title/api";
import { categoryApi } from "../features/category/api";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

const PUBLIC_KEYS = ["movies", "series", "anime", "documentaries"];

function emptyQuery(q: string): TitleSearchQuery {
  return {
    q,
    category_keys: [],
    kinds: [],
    year_from: null,
    year_to: null,
    genres: [],
    actor: null,
    director: null,
    resolutions: [],
    codecs: [],
    audio_langs: [],
  };
}

function isActive(query: TitleSearchQuery): boolean {
  return Boolean(
    (query.q ?? "").trim() ||
      (query.actor ?? "").trim() ||
      (query.director ?? "").trim() ||
      query.year_from !== null ||
      query.year_to !== null ||
      query.category_keys.length ||
      query.kinds.length ||
      query.genres.length ||
      query.resolutions.length ||
      query.codecs.length ||
      query.audio_langs.length
  );
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * Explorateur / Search Engine (Étape 7) : recherche multicritère sur les
 * 4 catégories publiques (nom, nature, catégories, années, genres,
 * acteur, réalisateur, résolution, codec, langue audio). Débounce 300 ms,
 * facets distinctes chargées une fois, résultats en grille d'affiches
 * cliquables vers la page du Titre.
 */
export function ExplorePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlQuery = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQuery);
  const [query, setQuery] = useState<TitleSearchQuery>(() => emptyQuery(urlQuery));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [results, setResults] = useState<TitleSearchResult[] | null>(null);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // La barre de recherche du haut arrive ici via /explore?q=…
  useEffect(() => {
    setQ(urlQuery);
    setQuery((prev) => ({ ...prev, q: urlQuery }));
  }, [urlQuery]);

  useEffect(() => {
    categoryApi
      .list()
      .then((list) => setCategories(list.filter((c) => PUBLIC_KEYS.includes(c.key))))
      .catch(() => {});
    titleApi.facets().then(setFacets).catch(() => {});
  }, []);

  const active = useMemo(() => isActive(query), [query]);

  useEffect(() => {
    if (!active) {
      setResults(null);
      return;
    }
    const handle = window.setTimeout(() => {
      titleApi
        .search(query)
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, active]);

  const patch = (partial: Partial<TitleSearchQuery>) =>
    setQuery((prev) => ({ ...prev, ...partial }));

  return (
    <div>
      <PageHeader
        title="Explorer"
        description="Recherche multicritères dans Films, Séries, Anime et Documentaires."
      />
      <div className="avm-explore-bar">
        <input
          type="search"
          className="avm-explore-input"
          placeholder="Nom d'un film ou d'une série…"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            patch({ q: event.target.value });
          }}
        />
        <Button variant="secondary" onClick={() => setFiltersOpen((open) => !open)}>
          <SlidersHorizontal size={14} /> Filtres
        </Button>
      </div>

      {filtersOpen && (
        <div className="avm-explore-filters">
          <div className="avm-explore-filters__row">
            <span className="avm-explore-filters__label">Nature</span>
            <button className={query.kinds.includes("movie") ? "avm-chip avm-chip--active" : "avm-chip"} onClick={() => patch({ kinds: toggle(query.kinds, "movie") })}>Film</button>
            <button className={query.kinds.includes("series") ? "avm-chip avm-chip--active" : "avm-chip"} onClick={() => patch({ kinds: toggle(query.kinds, "series") })}>Série</button>
          </div>
          <div className="avm-explore-filters__row">
            <span className="avm-explore-filters__label">Catégories</span>
            {categories.map((category) => (
              <button
                key={category.key}
                className={query.category_keys.includes(category.key) ? "avm-chip avm-chip--active" : "avm-chip"}
                onClick={() => patch({ category_keys: toggle(query.category_keys, category.key) })}
              >
                {category.name}
              </button>
            ))}
          </div>
          {facets && facets.genres.length > 0 && (
            <div className="avm-explore-filters__row">
              <span className="avm-explore-filters__label">Genres</span>
              {facets.genres.map((genre) => (
                <button
                  key={genre}
                  className={query.genres.includes(genre) ? "avm-chip avm-chip--active" : "avm-chip"}
                  onClick={() => patch({ genres: toggle(query.genres, genre) })}
                >
                  {genre}
                </button>
              ))}
            </div>
          )}
          <div className="avm-explore-filters__row">
            <span className="avm-explore-filters__label">Années</span>
            <input type="number" placeholder="de" value={query.year_from ?? ""} onChange={(e) => patch({ year_from: e.target.value === "" ? null : Number(e.target.value) })} />
            <input type="number" placeholder="à" value={query.year_to ?? ""} onChange={(e) => patch({ year_to: e.target.value === "" ? null : Number(e.target.value) })} />
            <input type="text" placeholder="Acteur" value={query.actor ?? ""} onChange={(e) => patch({ actor: e.target.value })} />
            <input type="text" placeholder="Réalisateur" value={query.director ?? ""} onChange={(e) => patch({ director: e.target.value })} />
          </div>
          {facets && (
            <div className="avm-explore-filters__row">
              <span className="avm-explore-filters__label">Technique</span>
              <select value={query.resolutions[0] ?? ""} onChange={(e) => patch({ resolutions: e.target.value === "" ? [] : [e.target.value] })}>
                <option value="">Résolution…</option>
                {facets.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={query.codecs[0] ?? ""} onChange={(e) => patch({ codecs: e.target.value === "" ? [] : [e.target.value] })}>
                <option value="">Codec…</option>
                {facets.codecs.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={query.audio_langs[0] ?? ""} onChange={(e) => patch({ audio_langs: e.target.value === "" ? [] : [e.target.value] })}>
                <option value="">Langue audio…</option>
                {facets.audio_langs.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <Button variant="ghost" onClick={() => { setQuery(emptyQuery(q)); }}>Réinitialiser</Button>
            </div>
          )}
        </div>
      )}

      {active && results !== null && (
        <p className="avm-settings-muted">{results.length} résultat(s)</p>
      )}
      {!active && (
        <EmptyState
          icon={<Compass size={32} />}
          title="Recherchez dans votre catalogue"
          description="Tapez un terme ci-dessus ou ouvrez les filtres (nature, catégorie, genre, année, acteur, résolution, codec, langue…)."
        />
      )}
      {active && results !== null && results.length === 0 && (
        <EmptyState title="Aucun résultat" description="Essayez d'élargir la recherche ou de retirer des filtres." />
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
  );
}