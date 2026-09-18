import { useEffect, useState } from "react";

const STORAGE_KEY = "aethervault:sidebar-collapsed";
const NARROW_QUERY = "(max-width: 860px)";

/**
 * Un seul état dérivé ("collapsed") pilote à la fois la largeur CSS de la
 * barre latérale et l'affichage des libellés de navigation — pour éviter
 * tout désaccord entre les deux (ex. libellés complets qui débordent d'une
 * barre devenue étroite par media query alors que l'état JS croit encore
 * "déplié"). En dessous du seuil de largeur, l'état est forcé à "réduit" ;
 * le bouton manuel est alors masqué (`isForced`) car il n'y a pas de place
 * pour déplier de toute façon.
 */
export function useSidebarCollapsed() {
  const [manualCollapsed, setManualCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  });

  const [isNarrow, setIsNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(manualCollapsed));
  }, [manualCollapsed]);

  return {
    collapsed: isNarrow || manualCollapsed,
    isForced: isNarrow,
    toggleCollapsed: () => setManualCollapsed((current) => !current),
  };
}
