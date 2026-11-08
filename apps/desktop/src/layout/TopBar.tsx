import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Film, SlidersHorizontal } from "lucide-react";
import { Avatar, SearchInput } from "@aethervault/ui-kit";
import type { TitleSearchQuery, TitleSearchResult } from "@aethervault/shared-types";
import { titleApi } from "../features/title/api";
import { ActiveFilterChips, TitleFilters } from "../features/search/TitleFilters";
import { useFacetCounts } from "../features/search/useFacetCounts";
import {
  countActiveFilters,
  emptyQuery,
  paramsToQuery,
  queryToParams,
} from "../features/search/queryParams";
import { useActiveProfile } from "../profile/ActiveProfileContext";
import { WindowControls } from "../components/WindowControls";
import { AetherFyQuickMenu } from "./AetherFyQuickMenu";
import "./topbar.css";

/** 0.4.0 : affiche de suggestion — URL distante telle quelle, chemin
local via convertFileSrc (asset Tauri). */
function posterSrc(poster: string | null): string | null {
  if (!poster) return null;
  return poster.startsWith("http://") || poster.startsWith("https://")
    ? poster
    : convertFileSrc(poster);
}

/**
Barre supérieure de la fenêtre principale. Depuis le passage frameless
(Étape 7, `"decorations": false` dans tauri.conf.json), elle sert aussi
de barre de titre : `data-tauri-drag-region` rend l'espace vide
draggable (les enfants — recherche, profil, boutons de fenêtre —
restent cliquables), et `<WindowControls />` remplace les boutons
natifs réduire/agrandir/fermer.

0.4.0 : suggestions de recherche sous la barre (mini-affiche + titre +
année), debounce 250 ms, clavier ↑/↓/Entrée/Échap, clic → fiche directe.

0.6.4 : raccourci AetherFy (`AetherFyQuickMenu`) — monté comme FRÈRE
du bouton profil dans `avm-topbar__right`, JAMAIS comme enfant : un
clic dans le menu ne doit pas déclencher `navigate("/profiles")`, et
« bouton dans bouton » est invalide en HTML.
*/
export function TopBar() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TitleSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  // Recherche avancée : filtres (type de média, genre, année, acteur,
  // réalisateur, saga, résolution, codec, langue) dans un panneau flottant
  // ouvert depuis le bouton à droite du champ. Le texte reste dans `query`.
  const [filters, setFilters] = useState<TitleSearchQuery>(() => emptyQuery());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const facets = useFacetCounts([], filtersOpen);
  const activeFilterCount = countActiveFilters(filters);
  const panelRef = useRef<HTMLDivElement>(null);
  // Vrai juste après une synchro depuis l'URL : évite de rouvrir les suggestions.
  const skipSuggestRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProfile } = useActiveProfile();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  // Menu de suggestions rendu dans <body> (portail) : la barre du haut
  // forme son propre contexte d'empilement (z-index 100), donc un menu
  // enfant — même à z-index 1200 — restait sous le reste de l'interface.
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const [dropdownFont, setDropdownFont] = useState<string | null>(null);
  const showDropdown = open && suggestions.length > 0 && !filtersOpen;

  useLayoutEffect(() => {
    if (!showDropdown && !filtersOpen) return;
    const place = () => {
      const root = rootRef.current;
      if (!root) return;
      const r = root.getBoundingClientRect();
      setAnchor({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    place();
    // Le portail vit hors de l'en-tête : on reprend sa police explicitement
    // (même approche qu'AetherFyQuickMenu).
    const host = rootRef.current?.closest("header");
    if (host) setDropdownFont(window.getComputedStyle(host).fontFamily);
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [showDropdown, filtersOpen]);

  useEffect(() => {
    if (!activeProfile) return;
    let cancelled = false;
    const load = () => {
      invoke<string | null>("get_profile_avatar", { profileId: activeProfile.id })
        .then((path) => {
          if (!cancelled) setAvatarUrl(path ? convertFileSrc(path) : null);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("avm-avatar-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("avm-avatar-changed", load);
    };
  }, [activeProfile, location.pathname]);

  // 0.4.0 : recherche debouncée — 2 caractères minimum, 250 ms.
  useEffect(() => {
    if (skipSuggestRef.current) {
      skipSuggestRef.current = false;
      return;
    }
    const trimmed = query.trim();
    const hasText = trimmed.length >= 2;
    if (!hasText && activeFilterCount === 0) {
      setSuggestions([]);
      setMatchCount(null);
      setOpen(false);
      setHighlight(-1);
      return;
    }
    const timeout = window.setTimeout(() => {
      const id = ++requestIdRef.current;
      titleApi
        .search({ ...filters, q: hasText ? trimmed : "" })
        .then((results) => {
          if (requestIdRef.current !== id) return;
          setMatchCount(results.length);
          setSuggestions(results.slice(0, 8));
          setOpen(results.length > 0);
          setHighlight(results.length > 0 ? 0 : -1);
        })
        .catch(() => {
          if (requestIdRef.current === id) {
            setSuggestions([]);
            setMatchCount(null);
            setOpen(false);
          }
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, filters, activeFilterCount]);

  // Sur la page de recherche, la barre reflète l'URL (texte + filtres) :
  // les deux restent cohérents quel que soit l'endroit où on les modifie.
  useEffect(() => {
    if (location.pathname !== "/search") return;
    const parsed = paramsToQuery(new URLSearchParams(location.search));
    skipSuggestRef.current = true;
    setQuery(parsed.q ?? "");
    setFilters({ ...parsed, q: "" });
  }, [location.pathname, location.search]);

  // 0.4.0 : fermeture au clic hors du dropdown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Le menu est dans un portail (hors de rootRef) : un mousedown sur une
      // suggestion ne doit PAS le fermer avant que le clic ne soit traité.
      if (
        rootRef.current?.contains(target) ||
        dropdownRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      )
        return;
      setOpen(false);
      setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // 0.4.0 : fermeture à chaque navigation.
  useEffect(() => {
    setOpen(false);
    setFiltersOpen(false);
    setHighlight(-1);
  }, [location.pathname, location.search]);

  const goToTitle = (r: TitleSearchResult) => {
    setOpen(false);
    setQuery("");
    setSuggestions([]);
    setHighlight(-1);
    navigate(`/category/${r.category_key}/title/${r.id}`);
  };

  const launchSearch = () => {
    const params = queryToParams({ ...filters, q: query.trim() });
    if (params.toString().length === 0) return;
    setOpen(false);
    setFiltersOpen(false);
    navigate(`/search?${params.toString()}`);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && filtersOpen) {
      setFiltersOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  };

  return (
    <header className="avm-topbar" data-tauri-drag-region>
      <div ref={rootRef} style={{ position: "relative" }} onKeyDown={handleKeyDown}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Rechercher un film, une série, un acteur…"
            onSubmit={() => {
              // Entrée : suggestion surlignée → fiche directe ; sinon page de
              // recherche avancée (texte + filtres choisis dans le panneau).
              if (open && highlight >= 0 && suggestions[highlight] && !filtersOpen) {
                goToTitle(suggestions[highlight]);
                return;
              }
              launchSearch();
            }}
          />
          <button
            type="button"
            className={`avm-topbar__filters${filtersOpen || activeFilterCount > 0 ? " avm-topbar__filters--on" : ""}`}
            onClick={() => {
              setOpen(false);
              setFiltersOpen((v) => !v);
            }}
            title="Recherche avancée : type de média, genre, année, acteur, réalisateur, saga, qualité…"
            aria-label="Recherche avancée"
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={16} />
            {activeFilterCount > 0 && <span className="avm-topbar__filters-badge">{activeFilterCount}</span>}
          </button>
        </div>
        {filtersOpen && anchor && createPortal(
          <div
            ref={panelRef}
            className="avm-topbar__filters-panel"
            style={{
              top: anchor.top,
              left: anchor.left,
              width: Math.min(880, Math.max(anchor.width, 640), window.innerWidth - anchor.left - 16),
              fontFamily: dropdownFont ?? "inherit",
            }}
          >
            <TitleFilters
              layout="grid"
              query={filters}
              facets={facets}
              onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
              onReset={() => setFilters(emptyQuery())}
            />
            <ActiveFilterChips query={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} />
            <div className="avm-topbar__filters-footer">
              <span className="avm-topbar__filters-count">
                {matchCount === null
                  ? "Choisissez un filtre ou tapez un terme"
                  : `${matchCount} résultat${matchCount > 1 ? "s" : ""}`}
              </span>
              <button type="button" className="avm-topbar__filters-go" onClick={launchSearch}>
                Afficher les résultats
              </button>
            </div>
          </div>,
          document.body
        )}
        {showDropdown && anchor && createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: anchor.top,
              left: anchor.left,
              width: anchor.width,
              zIndex: 2147483000,
              fontFamily: dropdownFont ?? "inherit",
              background: "var(--color-surface, #1b1b21)",
              border: "1px solid var(--color-border, #2c2c33)",
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 12px 32px rgba(0,0,0,.55)",
              maxHeight: 380,
              overflowY: "auto",
            }}
          >
            {suggestions.map((r, i) => {
              const src = posterSrc(r.poster);
              return (
                <button
                  key={`${r.category_key}-${r.id}`}
                  type="button"
                  onClick={() => goToTitle(r)}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 10px",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    font: "inherit",
                    background:
                      i === highlight
                        ? "color-mix(in srgb, var(--color-accent, #7c5cff) 16%, transparent)"
                        : "transparent",
                    color: "var(--color-text, #f2f2f5)",
                  }}
                >
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      style={{
                        width: 34,
                        height: 50,
                        objectFit: "cover",
                        borderRadius: 5,
                        background: "#000",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 34,
                        height: 50,
                        borderRadius: 5,
                        background: "#241b4d",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Film size={16} style={{ opacity: 0.5 }} />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-muted, #9a9aa3)",
                        marginTop: 2,
                      }}
                    >
                      {r.year ?? "—"} · {r.category_name} · {r.kind}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>,
          document.body
        )}
      </div>

         <div className="avm-topbar__right">
     {/* 0.6.4b : le raccourci doit être DANS le cluster de droite —
         posé entre le centre et la droite, il se retrouvait superposé
         au bouton de profil (le centre prend tout l'espace restant). */}
     <AetherFyQuickMenu />
     {activeProfile && (
          <button
            type="button"
            className="avm-topbar__profile"
            onClick={() => navigate("/profiles")}
            title="Changer de profil"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : (
              <Avatar name={activeProfile.name} size={28} />
            )}
            <span>{activeProfile.name}</span>
          </button>
        )}
        {/* Frameless : sans ceci, plus aucun bouton réduire/agrandir/fermer. */}
        <WindowControls />
      </div>
    </header>
  );
}