import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ReadingPage } from "./types";

interface Props {
  pages: ReadingPage[];
  isRtl: boolean;
  currentPage: number;
  onFlip: (pageIndex: number) => void;
  filterClass?: string;
  zoom?: number; // 1.0 par défaut
}

export function BookSimpleReader({
  pages,
  isRtl,
  currentPage,
  onFlip,
  filterClass = "",
  zoom = 1,
}: Props) {
  const page = pages[currentPage];
  const containerRef = useRef<HTMLDivElement>(null);

  // Clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        if (currentPage < pages.length - 1) onFlip(currentPage + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        if (currentPage > 0) onFlip(currentPage - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentPage, pages.length, onFlip]);

  if (!page) return null;

  return (
    <div
      ref={containerRef}
      className={`avm-book-simple ${filterClass}`}
      style={{ direction: isRtl ? "rtl" : "ltr" }}
    >
      <img
        src={convertFileSrc(page.path)}
        alt={`Page ${currentPage + 1}`}
        className="avm-book-simple__image"
        style={{ transform: `scale(${zoom})` }}
        draggable={false}
      />
      <div className="avm-book-simple__indicator">
        {currentPage + 1} / {pages.length}
      </div>
    </div>
  );
}