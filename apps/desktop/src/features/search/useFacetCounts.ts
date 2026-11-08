import { useEffect, useState } from "react";
import type { FacetCounts } from "@aethervault/shared-types";
import { titleApi } from "../title/api";

/**
 * Compteurs de facettes pour un périmètre de catégories (liste vide = tout
 * le catalogue public). `enabled=false` évite tout appel tant que le
 * panneau de filtres n'est pas ouvert.
 */
export function useFacetCounts(categoryKeys: string[], enabled = true): FacetCounts | null {
  const [facets, setFacets] = useState<FacetCounts | null>(null);
  const scope = categoryKeys.join(",");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    titleApi
      .facetCounts(scope ? scope.split(",") : [])
      .then((result) => {
        if (!cancelled) setFacets(result);
      })
      .catch(() => {
        if (!cancelled) setFacets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, enabled]);
  return facets;
}
