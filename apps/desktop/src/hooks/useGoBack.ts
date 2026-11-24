import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Bouton « Retour » fiable : revient à la page précédente de l'historique, et — si l'écran a
 * été ouvert directement (rien avant lui dans l'historique) — va à `fallback`.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else navigate(fallback);
  }, [location.key, navigate, fallback]);
}
