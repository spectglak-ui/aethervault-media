import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Maximize, Minimize, RotateCcw, Settings, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readingApi, type ReadingBook } from "../features/reading/api";
import { usePageFlip } from "../features/reader/usePageFlip";
import "../features/reader/book-reader.css";
import "./readingBookPage.css";

type DisplayMode = "spread" | "simple" | "scroll";
type AnimationMode = "flip" | "slide" | "fade";
type FilterMode = "none" | "grayscale" | "vivid" | "sepia" | "high-contrast";

function defaultMode(kind: string): DisplayMode {
  if (kind === "webtoon") return "scroll";
  if (kind === "roman") return "simple";
  return "spread";
}

/** 0.7.4 : détecte le ratio naturel d'une image (width/height). */
function probeImageRatio(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
    img.onerror = () => resolve(1);
    img.src = url;
  });
}

export function ReadingBookPage() {
  const { id } = useParams<{ id: string }>();
  const bookId = Number(id);
  const navigate = useNavigate();

  const [book, setBook] = useState<ReadingBook | null>(null);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DisplayMode>("spread");
  const [currentPage, setCurrentPage] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hideNonce, setHideNonce] = useState(0);

  const [animationMode, setAnimationMode] = useState<AnimationMode>("flip");
  const [filterMode, setFilterMode] = useState<FilterMode>("none");
  const [zoom, setZoom] = useState(1);
  const [isRtl, setIsRtl] = useState(true);

  const [pageRatios, setPageRatios] = useState<Record<number, number>>({});
  const [animClass, setAnimClass] = useState("");
  const prevPageRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, p, libraries] = await Promise.all([
          readingApi.getBook(bookId),
          readingApi.getProgress(bookId),
          readingApi.listLibraries(),
        ]);
        if (cancelled) return;

        const library = libraries.find((lib) => lib.id === b.library_id);
        if (!library) {
          throw new Error("Bibliothèque du livre introuvable.");
        }

        setBook(b);
        setMode(defaultMode(library.kind));
        setIsRtl(library.kind === "manga");
        if (p && p.current_page > 0) setCurrentPage(p.current_page);
        if (b.page_count <= 0) {
          setError("Aucune page extraite pour ce livre — relancez un scan de la bibliothèque.");
          return;
        }
        const paths = await Promise.all(
          Array.from({ length: b.page_count }, (_, i) => readingApi.getPage(bookId, i))
        );
        if (cancelled) return;
        const urls = paths.map((path) => convertFileSrc(path));
        setPageUrls(urls);

        const ratios: Record<number, number> = {};
        await Promise.all(
          urls.slice(0, 10).map(async (url, i) => {
            ratios[i] = await probeImageRatio(url);
          })
        );
        setPageRatios(ratios);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  const handleFlip = useCallback(
    (pageIndex: number) => {
      setUiVisible(true);

      if (animationMode !== "flip" && mode !== "scroll") {
        const direction = pageIndex > prevPageRef.current ? "next" : "prev";
        const cls = animationMode === "slide"
          ? `rbk-viewport--anim-${direction}`
          : "rbk-viewport--fade";
        setAnimClass(cls);
        window.setTimeout(() => setAnimClass(""), 450);
      }
      prevPageRef.current = pageIndex;

      setCurrentPage(pageIndex);
      if (!book) return;
      void readingApi.saveProgress(
        bookId,
        pageIndex,
        book.page_count,
        pageIndex >= book.page_count - 1
      );

      if (!(pageIndex in pageRatios) && pageUrls[pageIndex]) {
        probeImageRatio(pageUrls[pageIndex]).then((r) => {
          setPageRatios((prev) => ({ ...prev, [pageIndex]: r }));
        });
      }
    },
    [book, bookId, animationMode, mode, pageUrls, pageRatios]
  );

  const handleResetProgress = useCallback(async () => {
    if (!book) return;
    if (!window.confirm(`Réinitialiser la progression de « ${book.title} » ? Il repartira page 1.`)) return;
    try {
      await readingApi.resetProgress(bookId);
      setCurrentPage(0);
      navigate(-1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Réinitialisation impossible : ${msg}`);
    }
  }, [book, bookId, navigate]);

  const { containerRef, flipNext, flipPrev } = usePageFlip({
    images: pageUrls,
    isRtl,
    active: mode === "spread" && !loading && pageUrls.length > 0,
    startPage: currentPage,
    onFlip: handleFlip,
  });

  useEffect(() => {
    const strip = () => {
      const root =
        document.querySelector(".rbk-stage") ??
        document.querySelector(".avm-reading-book");
      if (!root) return;
      root.querySelectorAll<HTMLElement>("div, img").forEach((el) => {
        const cls = typeof el.className === "string" ? el.className : "";
        if (cls.includes("shadow")) return;
        el.style.background = "transparent";
        el.style.backgroundColor = "transparent";
      });
    };
    strip();
    const t = window.setTimeout(strip, 300);
    return () => window.clearTimeout(t);
  }, [mode, pageUrls.length, currentPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else if (isFullscreen) setIsFullscreen(false);
        else navigate(-1);
        return;
      }
      if (e.key === "f" || e.key === "F") {
        setIsFullscreen((f) => !f);
        return;
      }
      if (e.key === "h" || e.key === "H") {
        setUiVisible((v) => !v);
        return;
      }
      if (mode === "spread") {
        if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
          e.preventDefault();
          flipNext();
        } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
          e.preventDefault();
          flipPrev();
        }
      } else if (mode === "simple") {
        const forward = isRtl ? e.key === "ArrowLeft" : e.key === "ArrowRight" || e.key === " ";
        const backward = isRtl ? e.key === "ArrowRight" : e.key === "ArrowLeft";
        if (forward) {
          e.preventDefault();
          handleFlip(Math.min(pageUrls.length - 1, currentPage + 1));
        } else if (backward) {
          e.preventDefault();
          handleFlip(Math.max(0, currentPage - 1));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, isRtl, flipNext, flipPrev, currentPage, pageUrls.length, handleFlip, navigate, settingsOpen, isFullscreen]);

  useEffect(() => {
    if (!uiVisible || settingsOpen) return;
    const timer = window.setTimeout(() => setUiVisible(false), 8000);
    return () => window.clearTimeout(timer);
  }, [uiVisible, settingsOpen, currentPage, hideNonce]);

  const simpleUrl = pageUrls[currentPage] ?? null;
  const currentRatio = pageRatios[currentPage] ?? 1;
  const isLandscape = currentRatio > 1.2;
  const filterClass = filterMode !== "none" ? `filter-${filterMode}` : "";

  const stageClasses = [
    "rbk-stage",
    loading && "rbk-stage--loading",
    error && "rbk-stage--error",
    animationMode === "flip" && "rbk-stage--flip",
    animationMode === "slide" && "rbk-stage--slide",
    animationMode === "fade" && "rbk-stage--fade",
    isRtl && "rbk-stage--rtl",
    !isRtl && "rbk-stage--ltr",
    !uiVisible && "rbk-stage--ui-hidden",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={stageClasses}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".rbk-ui, .rbk-settings")) {
          setHideNonce((n) => n + 1);
          return;
        }
        setUiVisible((v) => !v);
      }}
    >
      {loading && (
        <div className="rbk-loader">
          <div>Extraction des pages…</div>
        </div>
      )}

      {error && (
        <div className="rbk-error">
          <button className="rbk-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Retour
          </button>
          <div>{error}</div>
        </div>
      )}

      {!loading && !error && (
        <>
          <div
            className={`rbk-viewport ${filterClass} ${animClass}`}
            style={{ transform: `scale(${zoom})` }}
          >
            {mode === "spread" && (
              <div ref={containerRef} className="rbk-spread" />
            )}

            {mode === "simple" && (
              <div className={`rbk-single-wrap ${isLandscape ? "rbk-single-wrap--landscape" : "rbk-single-wrap--portrait"}`}>
                {simpleUrl ? (
                  <img
                    src={simpleUrl}
                    alt={`Page ${currentPage + 1}`}
                    className="rbk-img"
                    draggable={false}
                    onLoad={(e) => {
                      if (!(currentPage in pageRatios)) {
                        const img = e.target as HTMLImageElement;
                        if (img.naturalWidth && img.naturalHeight) {
                          setPageRatios((prev) => ({
                            ...prev,
                            [currentPage]: img.naturalWidth / img.naturalHeight,
                          }));
                        }
                      }
                    }}
                  />
                ) : (
                  <div className="rbk-placeholder">Page indisponible</div>
                )}
              </div>
            )}

            {mode === "scroll" && (
              <div className="rbk-vertical">
                {pageUrls.map((url, i) => (
                  <div key={i} className="rbk-vertical__item">
                    <img
                      src={url}
                      alt={`Page ${i + 1}`}
                      className="rbk-img"
                      loading="lazy"
                      draggable={false}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`rbk-ui ${uiVisible ? "rbk-ui--visible" : ""}`}>
            <div className="rbk-topbar">
              <button className="rbk-back-btn" onClick={() => navigate(-1)}>
                <ArrowLeft size={16} /> Retour
              </button>
              <div className="rbk-title">
                <div className="rbk-title__name">{book?.title ?? "—"}</div>
                <div className="rbk-title__meta">
                  Page {currentPage + 1} / {pageUrls.length}
                </div>
              </div>
              <div className="rbk-topbar__actions">
                <button
                  className="rbk-icon-btn"
                  onClick={handleResetProgress}
                  title="Réinitialiser la progression"
                >
                  <RotateCcw size={18} />
                </button>
                <button
                  className="rbk-icon-btn"
                  onClick={() => setSettingsOpen((o) => !o)}
                  title="Réglages"
                >
                  <Settings size={18} />
                </button>
                <button
                  className="rbk-icon-btn"
                  onClick={() => setIsFullscreen((f) => !f)}
                  title="Plein écran"
                >
                  {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              </div>
            </div>

            <div className="rbk-bottombar">
              <button
                className="rbk-nav-btn"
                onClick={() => handleFlip(Math.max(0, currentPage - 1))}
                disabled={currentPage <= 0}
              >
                {isRtl ? "➡" : "⬅"} Précédent
              </button>
              <div className="rbk-progress-wrap">
                <input
                  type="range"
                  className="rbk-progress"
                  min={0}
                  max={pageUrls.length - 1}
                  value={currentPage}
                  onChange={(e) => handleFlip(Number(e.target.value))}
                />
                <span className="rbk-progress__label">
                  {currentPage + 1} / {pageUrls.length}
                </span>
              </div>
              <button
                className="rbk-nav-btn"
                onClick={() => handleFlip(Math.min(pageUrls.length - 1, currentPage + 1))}
                disabled={currentPage >= pageUrls.length - 1}
              >
                Suivant {isRtl ? "⬅" : "➡"}
              </button>
            </div>

            {settingsOpen && (
              <div className="rbk-settings" onClick={(e) => e.stopPropagation()}>
                <div className="rbk-settings__head">
                  <span>Réglages de lecture</span>
                  <button className="rbk-icon-btn" onClick={() => setSettingsOpen(false)}>
                    <X size={16} />
                  </button>
                </div>

                <div className="rbk-settings__row">
                  <span className="rbk-settings__label">Mode d'affichage</span>
                  <div className="rbk-segmented">
                    <button
                      className={`rbk-segmented__opt ${mode === "spread" ? "rbk-segmented__opt--active" : ""}`}
                      onClick={() => setMode("spread")}
                    >
                      Double
                    </button>
                    <button
                      className={`rbk-segmented__opt ${mode === "simple" ? "rbk-segmented__opt--active" : ""}`}
                      onClick={() => setMode("simple")}
                    >
                      Simple
                    </button>
                    <button
                      className={`rbk-segmented__opt ${mode === "scroll" ? "rbk-segmented__opt--active" : ""}`}
                      onClick={() => setMode("scroll")}
                    >
                      Scroll
                    </button>
                  </div>
                </div>

                {mode !== "scroll" && (
                  <div className="rbk-settings__row">
                    <span className="rbk-settings__label">Animation</span>
                    {mode === "spread" ? (
                      <div className="rbk-segmented">
                        <button className="rbk-segmented__opt rbk-segmented__opt--active" disabled>
                          3D (page curl)
                        </button>
                      </div>
                    ) : (
                      <div className="rbk-segmented">
                        <button
                          className={`rbk-segmented__opt ${animationMode === "flip" ? "rbk-segmented__opt--active" : ""}`}
                          onClick={() => setAnimationMode("flip")}
                        >
                          3D
                        </button>
                        <button
                          className={`rbk-segmented__opt ${animationMode === "slide" ? "rbk-segmented__opt--active" : ""}`}
                          onClick={() => setAnimationMode("slide")}
                        >
                          Slide
                        </button>
                        <button
                          className={`rbk-segmented__opt ${animationMode === "fade" ? "rbk-segmented__opt--active" : ""}`}
                          onClick={() => setAnimationMode("fade")}
                        >
                          Fondu
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {mode !== "scroll" && (
                  <div className="rbk-settings__row">
                    <span className="rbk-settings__label">Sens de lecture</span>
                    <div className="rbk-segmented">
                      <button
                        className={`rbk-segmented__opt ${!isRtl ? "rbk-segmented__opt--active" : ""}`}
                        onClick={() => setIsRtl(false)}
                      >
                        Gauche → Droite
                      </button>
                      <button
                        className={`rbk-segmented__opt ${isRtl ? "rbk-segmented__opt--active" : ""}`}
                        onClick={() => setIsRtl(true)}
                      >
                        Droite → Gauche
                      </button>
                    </div>
                  </div>
                )}

                <div className="rbk-settings__row">
                  <span className="rbk-settings__label">Amélioration image</span>
                  <div className="rbk-segmented">
                    <button
                      className={`rbk-segmented__opt ${filterMode === "none" ? "rbk-segmented__opt--active" : ""}`}
                      onClick={() => setFilterMode("none")}
                    >
                      Normal
                    </button>
                    <button
                      className={`rbk-segmented__opt ${filterMode === "grayscale" ? "rbk-segmented__opt--active" : ""}`}
                      onClick={() => setFilterMode("grayscale")}
                    >
                      N&B
                    </button>
                    <button
                      className={`rbk-segmented__opt ${filterMode === "vivid" ? "rbk-segmented__opt--active" : ""}`}
                      onClick={() => setFilterMode("vivid")}
                    >
                      Vif
                    </button>
                  </div>
                </div>

                <div className="rbk-settings__row">
                  <span className="rbk-settings__label">Zoom ({Math.round(zoom * 100)}%)</span>
                  <div className="rbk-zoom-row">
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}