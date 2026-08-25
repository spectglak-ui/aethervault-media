import { useCallback, useState } from "react";
import type { PrivateImageFile } from "@aethervault/shared-types";

/**
 * État de la visionneuse plein écran (Étape 6b-ii, doc §6.4 quater).
 *
 * Volontairement minimal pour cette version — seule la navigation entre
 * photos d'un même album est implémentée — mais structuré pour accueillir
 * plus tard, sans restructuration, des champs comme `zoom: number`,
 * `rotation: 0 | 90 | 180 | 270` ou `favoriteIds: Set<number>` : ce serait
 * de nouveaux champs sur ce même état, pas un nouveau système. Les actions
 * ci-dessous (`open`/`close`/`next`/`prev`/`goTo`) n'auraient pas non plus
 * à changer de signature pour ça — une future action `setZoom(level)`
 * s'ajouterait simplement à côté.
 */
export interface ImageViewerState {
  isOpen: boolean;
  items: PrivateImageFile[];
  currentIndex: number;
}

export interface ImageViewerControls {
  state: ImageViewerState;
  open: (items: PrivateImageFile[], startIndex: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
}

const INITIAL_STATE: ImageViewerState = { isOpen: false, items: [], currentIndex: 0 };

export function useImageViewer(): ImageViewerControls {
  const [state, setState] = useState<ImageViewerState>(INITIAL_STATE);

  const open = useCallback((items: PrivateImageFile[], startIndex: number) => {
    setState({ isOpen: true, items, currentIndex: startIndex });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const goTo = useCallback((index: number) => {
    setState((prev) => {
      if (prev.items.length === 0) return prev;
      const clamped = ((index % prev.items.length) + prev.items.length) % prev.items.length;
      return { ...prev, currentIndex: clamped };
    });
  }, []);

  const next = useCallback(() => {
    setState((prev) => {
      if (prev.items.length === 0) return prev;
      return { ...prev, currentIndex: (prev.currentIndex + 1) % prev.items.length };
    });
  }, []);

  const prev = useCallback(() => {
    setState((current) => {
      if (current.items.length === 0) return current;
      return { ...current, currentIndex: (current.currentIndex - 1 + current.items.length) % current.items.length };
    });
  }, []);

  return { state, open, close, next, prev, goTo };
}
