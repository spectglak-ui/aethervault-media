import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Film } from "lucide-react";
import { Avatar, SearchInput } from "@aethervault/ui-kit";
import type { TitleSearchResult } from "@aethervault/shared-types";
import { titleApi } from "../features/title/api";
import { useActiveProfile } from "../profile/ActiveProfileContext";
import { WindowControls } from "../components/WindowControls";

/** 0.4.0 : affiche de suggestion — URL distante telle quelle, chemin
 * local via convertFileSrc (asset Tauri). */
function posterSrc(poster: string | null): string | null {
  if (!poster) return null;
  return poster.startsWith("http://") || poster.startsWith("https://")
    ? poster
    : convertFileSrc(poster);
}

/**
 * Barre supérieure de la fenêtre principale. Depuis le passage frameless
 * (Étape 7, `"decorations": false` dans tauri.conf.json), elle sert aussi
 * de barre de titre : `data-tauri-drag-region` rend l'espace vide
 * draggable (les enfants — recherche, profil, boutons de fenêtre —
 * restent cliquables), et `<WindowControls />` remplace les boutons
 * natifs réduire/agrandir/fermer.
 *
 * 0.4.0 : suggestions de recherche sous la barre (mini-affiche + titre +
 * année), debounce 250 ms, clavier ↑/↓/Entrée/Échap, clic → fiche directe.
 */
export function TopBar() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TitleSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProfile } = useActiveProfile();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

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
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setHighlight(-1);
      return;
    }
    const timeout = window.setTimeout(() => {
      const id = ++requestIdRef.current;
      titleApi
        .search({ q: trimmed })
        .then((results) => {
          if (requestIdRef.current !== id) return;
          setSuggestions(results.slice(0, 8));
          setOpen(results.length > 0);
          setHighlight(results.length > 0 ? 0 : -1);
        })
        .catch(() => {
          if (requestIdRef.current === id) {
            setSuggestions([]);
            setOpen(false);
          }
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  // 0.4.0 : fermeture au clic hors du dropdown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // 0.4.0 : fermeture à chaque navigation.
  useEffect(() => {
    setOpen(false);
    setHighlight(-1);
  }, [location.pathname, location.search]);

  const goToTitle = (r: TitleSearchResult) => {
    setOpen(false);
    setQuery("");
    setSuggestions([]);
    setHighlight(-1);
    navigate(`/category/${r.category_key}/title/${r.id}`);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Rechercher un film, une série, un acteur…"
          onSubmit={() => {
            // Entrée : suggestion surlignée → fiche directe ; sinon Explore.
            if (open && highlight >= 0 && suggestions[highlight]) {
              goToTitle(suggestions[highlight]);
              return;
            }
            const trimmed = query.trim();
            if (trimmed.length > 0) {
              setOpen(false);
              navigate(`/explore?q=${encodeURIComponent(trimmed)}`);
            }
          }}
        />
        {open && suggestions.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 1200,
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
          </div>
        )}
      </div>
      <div className="avm-topbar__right">
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
        <WindowControls />
      </div>
    </header>
  );
}