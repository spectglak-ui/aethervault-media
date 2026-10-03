import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * FONCTIONNALITÉ (fond animé par-dessus les fonds de page) :
 *
 * Le premier essai empilait le fond animé global (z-index) au-dessus du
 * fond statique propre à chaque page (Catégories, Accueil, fiche média)
 * — en théorie suffisant, mais les deux vivent dans des arbres de
 * composants séparés (l'un dans App.tsx, l'autre routé), et un ancêtre
 * quelconque (transform, filter, etc. — fréquent avec `framer-motion`,
 * utilisé dans ce projet) peut créer un contexte d'empilement local qui
 * invalide la comparaison de z-index entre les deux arbres. Plutôt que
 * de continuer à ajuster des nombres sans pouvoir vérifier le rendu
 * réel, ce hook permet à chaque page de simplement RENONCER à afficher
 * SON PROPRE fond statique quand le fond animé est actif — une
 * garantie qui ne dépend d'aucune subtilité CSS.
 *
 * Utilisé par CategoryPage.tsx, HomePage.tsx, TitleDetailPage.tsx
 * (uniquement pour sa variante image statique — pas pour la
 * bande-annonce, qui doit rester visible).
 */
export function useAnimatedBackdropActive(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      Promise.all([
        invoke<boolean>("get_backdrop_video_enabled").catch(() => false),
        invoke<string | null>("get_home_backdrop_video").catch(() => null),
      ]).then(([enabled, path]) => {
        if (alive) setActive(enabled && !!path);
      });
    };
    refresh();
    window.addEventListener("avm-home-backdrop-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("avm-home-backdrop-changed", refresh);
    };
  }, []);

  return active;
}
