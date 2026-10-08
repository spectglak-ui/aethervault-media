import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SearchX } from "lucide-react";
import type { SearchResult } from "../vaulttube/api";
import { vaultTubeApi } from "../vaulttube/api";

/**
 * 0.7.2 (Phase 2) â€” rÃ©sultats de recherche en ligne (commande
 * `vaulttube_search`, yt-dlp sans clÃ© API). PrÃ©sentation "liste" style
 * YouTube : miniature 16:9 Ã  gauche, titre + chaÃ®ne Ã  droite. Un clic
 * ouvre la page watch AetherFy correspondante.
 */
export function AetherFySearchPage() {
  const [params] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const navigate = useNavigate();

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    vaultTubeApi
      .search(query)
      .then((r) => {
        if (!cancelled) setResults(r.filter((x) => x.kind === "video"));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Recherche impossible.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div>
      <div className="afy-search-head">
        <h2 className="afy-row__title">
          RÃ©sultats pour Â« <span className="afy-search-head__q">{query || "â€¦"}</span> Â»
        </h2>
      </div>

      {loading && <div className="afy-loader">Recherche dans le rÃªveâ€¦</div>}

      {!loading && error && (
        <div className="afy-empty">
          <div className="afy-empty__title">{error}</div>
        </div>
      )}

      {!loading && !error && results.length === 0 && query !== "" && (
        <div className="afy-empty">
          <SearchX size={40} className="afy-empty__icon" />
          <div className="afy-empty__title">Aucun rÃ©sultat</div>
          <div>Essayez d'autres mots-clÃ©s, ou vÃ©rifiez la connexion rÃ©seau.</div>
        </div>
      )}

      <div className="afy-search-list">
        {results.map((r) => (
          <button
            key={`${r.source}-${r.id}`}
            type="button"
            className="afy-search-item"
            onClick={() => navigate(`/aetherfy/watch/${r.id}`)}
          >
            {r.thumbnail_url ? (
              <img className="afy-search-item__thumb" src={r.thumbnail_url} alt="" loading="lazy" />
            ) : (
              <div className="afy-search-item__thumb" />
            )}
            <div className="afy-search-item__info">
              <h3 className="afy-search-item__title">{r.title}</h3>
              <div className="afy-search-item__channel">{r.channel ?? r.source}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
