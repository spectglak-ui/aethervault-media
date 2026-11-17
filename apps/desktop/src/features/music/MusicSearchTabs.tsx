import { useSearchParams } from "react-router-dom";
import { AetherFySearchPage } from "../aetherfy/AetherFySearchPage";
import { MusicSearchResults } from "./MusicSearchResults";
import type { MusicSearchKind } from "./api";
import "./music.css";

type Scope = "videos" | MusicSearchKind;

const SCOPES: { scope: Scope; label: string }[] = [
  { scope: "videos", label: "Vidéos" },
  { scope: "track", label: "Titres" },
  { scope: "album", label: "Albums" },
  { scope: "artist", label: "Artistes" },
];

const STORAGE_KEY = "avm.afy.searchScope";

function readStoredScope(): Scope {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "track" || stored === "album" || stored === "artist" || stored === "videos") return stored;
  } catch {
    /* stockage indisponible */
  }
  return "videos";
}

/**
 * Page de recherche AetherFy : vidéos (recherche YouTube d'origine) ou catalogue
 * musical par titres, albums et artistes. L'onglet choisi est mémorisé.
 */
export function MusicSearchTabs() {
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const asked = params.get("scope");
  const scope: Scope =
    asked === "track" || asked === "album" || asked === "artist" || asked === "videos"
      ? asked
      : readStoredScope();

  const select = (next: Scope) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignoré */
    }
    const nextParams = new URLSearchParams(params);
    nextParams.set("scope", next);
    setParams(nextParams, { replace: true });
  };

  return (
    <div>
      <div className="avm-music-tabs" role="tablist" aria-label="Type de recherche">
        {SCOPES.map((s) => (
          <button
            key={s.scope}
            type="button"
            role="tab"
            aria-selected={scope === s.scope}
            className={`avm-music-tab${scope === s.scope ? " avm-music-tab--active" : ""}`}
            onClick={() => select(s.scope)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {scope === "videos" ? <AetherFySearchPage /> : <MusicSearchResults query={query} kind={scope} />}
    </div>
  );
}
