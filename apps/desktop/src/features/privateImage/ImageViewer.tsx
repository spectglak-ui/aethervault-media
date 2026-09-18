import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { IconButton } from "@aethervault/ui-kit";
import { assetUrl } from "../../lib/assetUrl";
import type { ImageViewerControls } from "./useImageViewer";
import { useViewerKeyboardShortcuts } from "./useViewerKeyboardShortcuts";
import "./imageViewer.css";

/**
 * Visionneuse plein écran (Étape 6b-ii, doc §6.4 quater) — pensée comme la
 * fondation de la future galerie, pas comme une fonctionnalité figée.
 * Diaporama, zoom, rotation, favoris, informations EXIF détaillées et
 * raccourcis supplémentaires ne sont volontairement **pas implémentés**
 * ici (décision explicite : ne pas construire par anticipation de
 * fonctionnalités non demandées), mais la structure ci-dessous les
 * accueillerait sans restructuration :
 * - la zone image (`__image-wrap`) est déjà isolée dans son propre
 *   conteneur — un futur zoom/rotation n'aurait qu'à y appliquer un
 *   transform CSS, sans toucher au reste ;
 * - la barre d'outils (`__toolbar`) est déjà un conteneur flexible séparé
 *   de la navigation — de futurs boutons (favori, informations EXIF,
 *   diaporama) s'y ajouteraient sans rien déplacer ;
 * - les raccourcis clavier vivent dans leur propre hook
 *   (`useViewerKeyboardShortcuts`), pas mêlés au rendu ;
 * - l'état (`useImageViewer`) est déjà structuré pour accueillir de
 *   nouveaux champs (zoom, rotation, favoris) sans changer la forme des
 *   actions existantes.
 *
 * Affiche l'image en **pleine résolution** depuis le disque
 * (`assetUrl`/`convertFileSrc`, comme n'importe quel fichier public) —
 * jamais la vignette chiffrée, réservée à la grille (doc §6.4 quater).
 */
export function ImageViewer({ controls }: { controls: ImageViewerControls }) {
  const { state, close, next, prev } = controls;

  useViewerKeyboardShortcuts(state.isOpen, next, prev, close);

  if (!state.isOpen || state.items.length === 0) {
    return null;
  }

  const current = state.items[state.currentIndex];

  return (
    <div className="avm-image-viewer" role="dialog" aria-modal="true">
      <button type="button" className="avm-image-viewer__backdrop" aria-label="Fermer" onClick={close} />

      <div className="avm-image-viewer__content">
        <div className="avm-image-viewer__image-wrap">
          <img src={assetUrl(current.path)} alt={current.file_name} className="avm-image-viewer__image" />
        </div>

        <div className="avm-image-viewer__toolbar">
          <span className="avm-image-viewer__caption">
            {current.file_name}
            {state.items.length > 1 && (
              <span className="avm-image-viewer__position">
                {state.currentIndex + 1} / {state.items.length}
              </span>
            )}
          </span>
          <IconButton label="Fermer la visionneuse" onClick={close}>
            <X size={20} />
          </IconButton>
        </div>

        {state.items.length > 1 && (
          <>
            <IconButton
              label="Photo précédente"
              onClick={prev}
              className="avm-image-viewer__nav avm-image-viewer__nav--prev"
            >
              <ChevronLeft size={28} />
            </IconButton>
            <IconButton
              label="Photo suivante"
              onClick={next}
              className="avm-image-viewer__nav avm-image-viewer__nav--next"
            >
              <ChevronRight size={28} />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
