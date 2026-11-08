import { useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { FacetCount, FacetCounts, TitleSearchQuery } from "@aethervault/shared-types";
import { MEDIA_TYPES, toggleValue } from "./queryParams";
import "./search.css";

/** Libellé lisible d'un code de langue (« fr » → « français ») quand le
    navigateur sait le traduire, sinon le code en majuscules. */
export function languageLabel(code: string): string {
  try {
    const label = new Intl.DisplayNames(["fr"], { type: "language" }).of(code);
    if (label && label.toLowerCase() !== code.toLowerCase()) {
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
  } catch {
    /* code non ISO 639-1 : on garde le code */
  }
  return code.toUpperCase();
}

function FilterGroup({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="avm-filter-group" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="avm-filter-group__body">{children}</div>
    </details>
  );
}

/** Liste de cases à cocher avec compteurs (comme dans la bande-annonce). */
function CheckList({
  items,
  selected,
  onToggle,
  label = (v: string) => v,
  visible = 8,
}: {
  items: FacetCount[];
  selected: string[];
  onToggle: (value: string) => void;
  label?: (value: string) => string;
  visible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // Les valeurs cochées restent toujours visibles, même repliées.
  const shown = expanded
    ? items
    : items.filter((item, index) => index < visible || selected.includes(item.value));
  return (
    <>
      {shown.map((item) => (
        <label key={item.value} className="avm-filter-check">
          <input
            type="checkbox"
            checked={selected.includes(item.value)}
            onChange={() => onToggle(item.value)}
          />
          <span>{label(item.value)}</span>
          <span className="avm-filter-count">{item.count}</span>
        </label>
      ))}
      {items.length > visible && (
        <button type="button" className="avm-filter-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Voir moins" : `Voir tout (${items.length})`}
        </button>
      )}
    </>
  );
}

function ChipList({
  items,
  selected,
  onToggle,
  label = (v: string) => v,
}: {
  items: FacetCount[];
  selected: string[];
  onToggle: (value: string) => void;
  label?: (value: string) => string;
}) {
  return (
    <div className="avm-filter-chips">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`avm-filter-chip${selected.includes(item.value) ? " avm-filter-chip--on" : ""}`}
          aria-pressed={selected.includes(item.value)}
          onClick={() => onToggle(item.value)}
        >
          {label(item.value)} <span className="avm-filter-count">{item.count}</span>
        </button>
      ))}
    </div>
  );
}

interface TitleFiltersProps {
  query: TitleSearchQuery;
  onChange: (patch: Partial<TitleSearchQuery>) => void;
  onReset: () => void;
  facets: FacetCounts | null;
  /** Rangée « Type de média » (inutile sur une page de catégorie). */
  showMediaType?: boolean;
  /** Champ de texte libre en tête du panneau. */
  showTextSearch?: boolean;
  textPlaceholder?: string;
  /** `grid` : colonnes multiples pour le panneau flottant de la barre globale. */
  layout?: "stack" | "grid";
}

/**
 * Panneau de filtres partagé par la recherche globale, la page de résultats
 * et les pages Catégorie : type de média, genre, année, acteur, réalisateur,
 * saga, résolution, codec, langue — avec compteurs quand ils sont connus.
 */
export function TitleFilters({
  query,
  onChange,
  onReset,
  facets,
  showMediaType = true,
  showTextSearch = false,
  textPlaceholder = "Rechercher…",
  layout = "stack",
}: TitleFiltersProps) {
  const uid = useId();
  const actorList = `${uid}-actors`;
  const directorList = `${uid}-directors`;
  const decadeActive = (decade: number) =>
    query.year_from === decade && query.year_to === decade + 9;

  return (
    <div className={`avm-filters${layout === "grid" ? " avm-filters--grid" : ""}`}>
      <div className="avm-filters__head">
        <span className="avm-filters__title">Filtres</span>
        <button type="button" className="avm-filter-more" onClick={onReset}>
          Réinitialiser
        </button>
      </div>

      {showTextSearch && (
        <input
          className="avm-filter-input avm-filter-input--text"
          type="search"
          value={query.q ?? ""}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder={textPlaceholder}
          aria-label={textPlaceholder}
        />
      )}

      {showMediaType && (
        <FilterGroup title="Type de média">
          {MEDIA_TYPES.map((type) => (
            <label key={type.key} className="avm-filter-check">
              <input
                type="checkbox"
                checked={query.category_keys.includes(type.key)}
                onChange={() =>
                  onChange({ category_keys: toggleValue(query.category_keys, type.key) })
                }
              />
              <span>{type.label}</span>
            </label>
          ))}
        </FilterGroup>
      )}

      {facets && facets.genres.length > 0 && (
        <FilterGroup title="Genre">
          <CheckList
            items={facets.genres}
            selected={query.genres}
            onToggle={(value) => onChange({ genres: toggleValue(query.genres, value) })}
          />
        </FilterGroup>
      )}

      <FilterGroup title="Année">
        {facets && facets.decades.length > 0 && (
          <div className="avm-filter-chips">
            {facets.decades.map((d) => {
              const decade = Number(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  className={`avm-filter-chip${decadeActive(decade) ? " avm-filter-chip--on" : ""}`}
                  aria-pressed={decadeActive(decade)}
                  onClick={() =>
                    decadeActive(decade)
                      ? onChange({ year_from: null, year_to: null })
                      : onChange({ year_from: decade, year_to: decade + 9 })
                  }
                >
                  {decade}s <span className="avm-filter-count">{d.count}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="avm-filter-years">
          <input
            className="avm-filter-input"
            type="number"
            inputMode="numeric"
            placeholder={facets?.year_min ? `De ${facets.year_min}` : "De"}
            value={query.year_from ?? ""}
            onChange={(e) =>
              onChange({ year_from: e.target.value === "" ? null : Number(e.target.value) })
            }
            aria-label="Année de début"
          />
          <input
            className="avm-filter-input"
            type="number"
            inputMode="numeric"
            placeholder={facets?.year_max ? `À ${facets.year_max}` : "À"}
            value={query.year_to ?? ""}
            onChange={(e) =>
              onChange({ year_to: e.target.value === "" ? null : Number(e.target.value) })
            }
            aria-label="Année de fin"
          />
        </div>
      </FilterGroup>

      <FilterGroup title="Acteur">
        <input
          className="avm-filter-input"
          type="text"
          list={actorList}
          value={query.actor ?? ""}
          onChange={(e) => onChange({ actor: e.target.value || null })}
          placeholder="Nom d'un acteur"
          aria-label="Acteur"
        />
        <datalist id={actorList}>
          {(facets?.actors ?? []).map((a) => (
            <option key={a.value} value={a.value} />
          ))}
        </datalist>
      </FilterGroup>

      <FilterGroup title="Réalisateur">
        <input
          className="avm-filter-input"
          type="text"
          list={directorList}
          value={query.director ?? ""}
          onChange={(e) => onChange({ director: e.target.value || null })}
          placeholder="Nom d'un réalisateur"
          aria-label="Réalisateur"
        />
        <datalist id={directorList}>
          {(facets?.directors ?? []).map((d) => (
            <option key={d.value} value={d.value} />
          ))}
        </datalist>
      </FilterGroup>

      {facets && facets.sagas.length > 0 && (
        <FilterGroup title="Saga">
          <select
            className="avm-filter-input"
            value={query.sagas[0] ?? ""}
            onChange={(e) => onChange({ sagas: e.target.value ? [e.target.value] : [] })}
            aria-label="Saga"
          >
            <option value="">Toutes les sagas</option>
            {facets.sagas.map((s) => (
              <option key={s.value} value={s.value}>
                {s.value} ({s.count})
              </option>
            ))}
          </select>
        </FilterGroup>
      )}

      {facets && facets.resolutions.length > 0 && (
        <FilterGroup title="Résolution">
          <ChipList
            items={facets.resolutions}
            selected={query.resolutions}
            onToggle={(value) => onChange({ resolutions: toggleValue(query.resolutions, value) })}
          />
        </FilterGroup>
      )}

      {facets && facets.codecs.length > 0 && (
        <FilterGroup title="Codec" defaultOpen={false}>
          <ChipList
            items={facets.codecs}
            selected={query.codecs}
            onToggle={(value) => onChange({ codecs: toggleValue(query.codecs, value) })}
          />
        </FilterGroup>
      )}

      {facets && facets.audio_langs.length > 0 && (
        <FilterGroup title="Langue audio" defaultOpen={false}>
          <ChipList
            items={facets.audio_langs}
            selected={query.audio_langs}
            label={languageLabel}
            onToggle={(value) => onChange({ audio_langs: toggleValue(query.audio_langs, value) })}
          />
        </FilterGroup>
      )}
    </div>
  );
}

interface ActiveFilterChipsProps {
  query: TitleSearchQuery;
  onChange: (patch: Partial<TitleSearchQuery>) => void;
  /** Masque la pastille « type de média » (déjà implicite sur une page de catégorie). */
  showMediaType?: boolean;
}

/** Pastilles des filtres actifs, retirables une à une (comme dans la bande-annonce). */
export function ActiveFilterChips({ query, onChange, showMediaType = true }: ActiveFilterChipsProps) {
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (showMediaType) {
    for (const key of query.category_keys) {
      const label = MEDIA_TYPES.find((t) => t.key === key)?.label ?? key;
      chips.push({
        key: `type-${key}`,
        label,
        remove: () => onChange({ category_keys: query.category_keys.filter((k) => k !== key) }),
      });
    }
  }
  for (const genre of query.genres) {
    chips.push({
      key: `genre-${genre}`,
      label: genre,
      remove: () => onChange({ genres: query.genres.filter((g) => g !== genre) }),
    });
  }
  if (query.year_from != null || query.year_to != null) {
    const label =
      query.year_from != null && query.year_to != null
        ? `${query.year_from} – ${query.year_to}`
        : query.year_from != null
          ? `Depuis ${query.year_from}`
          : `Jusqu'à ${query.year_to}`;
    chips.push({ key: "years", label, remove: () => onChange({ year_from: null, year_to: null }) });
  }
  if (query.actor?.trim()) {
    chips.push({ key: "actor", label: `Acteur : ${query.actor}`, remove: () => onChange({ actor: null }) });
  }
  if (query.director?.trim()) {
    chips.push({
      key: "director",
      label: `Réalisateur : ${query.director}`,
      remove: () => onChange({ director: null }),
    });
  }
  for (const saga of query.sagas) {
    chips.push({ key: `saga-${saga}`, label: saga, remove: () => onChange({ sagas: [] }) });
  }
  for (const res of query.resolutions) {
    chips.push({
      key: `res-${res}`,
      label: res,
      remove: () => onChange({ resolutions: query.resolutions.filter((r) => r !== res) }),
    });
  }
  for (const codec of query.codecs) {
    chips.push({
      key: `codec-${codec}`,
      label: codec,
      remove: () => onChange({ codecs: query.codecs.filter((c) => c !== codec) }),
    });
  }
  for (const lang of query.audio_langs) {
    chips.push({
      key: `lang-${lang}`,
      label: languageLabel(lang),
      remove: () => onChange({ audio_langs: query.audio_langs.filter((l) => l !== lang) }),
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="avm-active-chips" aria-label="Filtres actifs">
      {chips.map((chip) => (
        <span key={chip.key} className="avm-active-chip">
          {chip.label}
          <button type="button" onClick={chip.remove} aria-label={`Retirer le filtre ${chip.label}`}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
