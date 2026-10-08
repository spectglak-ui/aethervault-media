import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ReadingPage } from "./types";

interface Props {
  pages: ReadingPage[];
  filterClass?: string;
  onProgress?: (pageIndex: number) => void;
}

/**
 * Mode Webtoon : toutes les pages empilées verticalement, scroll infini.
 * Le "progress" est calculé par IntersectionObserver sur les pages visibles.
 */
export function BookScrollReader({
  pages,
  filterClass = "",
  onProgress,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLImageElement | null)[]>([]);

  // Détection de la page la plus visible (pour sauvegarder la progression).
  useEffect(() => {
    if (!onProgress) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Trouve l'entrée avec le plus grand ratio visible.
        let bestIndex = -1;
        let bestRatio = 0;
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            const idx = pageRefs.current.indexOf(entry.target as HTMLImageElement);
            if (idx !== -1) bestIndex = idx;
          }
        });
        if (bestIndex !== -1) onProgress(bestIndex);
      },
      { root: containerRef.current, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    pageRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [pages, onProgress]);

  return (
    <div ref={containerRef} className={`avm-book-scroll ${filterClass}`}>
      {pages.map((page, i) => (
        <img
          key={page.id}
          ref={(el) => {
            pageRefs.current[i] = el;
          }}
          src={convertFileSrc(page.path)}
          alt={`Page ${i + 1}`}
          className="avm-book-scroll__page"
          loading="lazy"
          draggable={false}
        />
      ))}
    </div>
  );
}