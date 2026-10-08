import { useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ReadingPage } from "./types";
import { usePageFlip } from "./usePageFlip";
import "./book-reader.css";

interface Props {
  pages: ReadingPage[];
  isRtl: boolean;
  currentPage: number;
  onFlip: (pageIndex: number) => void;
  /** Filtre CSS appliqué à la racine (N&B, vif, sepia...) — hérité par le canvas */
  filterClass?: string;
}

export function BookSpreadReader({
  pages,
  isRtl,
  currentPage,
  onFlip,
  filterClass = "",
}: Props) {
  const imageUrls = pages.map((p) => convertFileSrc(p.path));

  const { containerRef, flipNext, flipPrev } = usePageFlip({
    images: imageUrls,
    isRtl,
    active: true,
    onFlip,
  });

  // Synchronise la position quand l'utilisateur change de page via
  // un contrôle externe (barre de navigation, clavier...).
  // Non implémenté ici pour rester simple : page-flip gère ses propres
  // contrôles via `flipNext`/`flipPrev`.

  // Gestion clavier : flèches + espace
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        flipNext();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        flipPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipNext, flipPrev]);

  return (
    <div className={`avm-book-spread ${filterClass}`}>
      {/* Conteneur du canvas page-flip. Les filtres CSS s'appliquent nativement au canvas. */}
      <div ref={containerRef} className="avm-book-spread__canvas" />

      {/* Contrôles flottants */}
      <div className="avm-book-spread__controls">
        <button
          type="button"
          className="avm-book-spread__nav"
          onClick={flipPrev}
          aria-label="Page précédente"
        >
          {isRtl ? "➡" : "⬅"}
        </button>
        <button
          type="button"
          className="avm-book-spread__nav"
          onClick={flipNext}
          aria-label="Page suivante"
        >
          {isRtl ? "⬅" : "➡"}
        </button>
      </div>

      {/* Indicateur de progression */}
      <div className="avm-book-spread__indicator">
        {currentPage + 1} / {pages.length}
      </div>
    </div>
  );
}