import { useEffect } from "react";

/**
 * Raccourcis clavier de la visionneuse (Étape 6b-ii, doc §6.4 quater).
 * Séparé de `ImageViewer` en un hook dédié : ajouter un raccourci plus
 * tard (zoom `+`/`-`, rotation `r`, favori `f`...) se fera ici, sans
 * toucher au rendu du composant. `onNext`/`onPrev`/`onClose` viennent de
 * `useImageViewer()`, déjà stables (`useCallback`) — l'effet ne se
 * ré-enregistre donc pas à chaque rendu.
 */
export function useViewerKeyboardShortcuts(
  isActive: boolean,
  onNext: () => void,
  onPrev: () => void,
  onClose: () => void
): void {
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        onNext();
      } else if (event.key === "ArrowLeft") {
        onPrev();
      } else if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, onNext, onPrev, onClose]);
}
