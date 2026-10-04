import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  BookOpen,
  Columns2,
  Contrast,
  Eye,
  Maximize,
  Minimize,
  Minus,
  Palette,
  Plus,
  ScrollText,
  Settings2,
  Square,
  X,
} from "lucide-react";
import {
  readingApi,
  type ReadingBook,
  type ReadingLibraryKind,
  type ReadingProgress,
} from "../features/reading/api";
import "./readingBookPage.css";

/** Mode d'affichage des pages. */
type DisplayMode = "single" | "spread" | "vertical";
/** Filtre d'amélioration d'image appliqué au rendu. */
type ImageFilter = "none" | "bw" | "color";
/** Type d'animation de transition entre deux pages. */
type AnimationKind = "flip" | "slide" | "fade" | "none";

/** Sens de lecture par défaut selon le type de bibliothèque :
    manga = RTL, webtoon = vertical (ignore la notion de sens),
    bd/roman = LTR. */
function defaultDirection(kind: ReadingLibraryKind): "rtl" | "ltr" | "vertical" {
  if (kind === "manga") return "rtl";
  if (kind === "webtoon") return "vertical";
  return "ltr";
}

/**
 * `ReadingBook` ne déclare pas encore `kind` dans son contrat TypeScript,
 * mais l'API peut le fournir à l'exécution. On le lit donc de façon
 * compatible avec le type actuel et on retombe sur `roman` si absent.
 */
type ReadingBookWithRuntimeKind = ReadingBook & { kind?: ReadingLibraryKind };

function getReadingBookKind(book: ReadingBook): ReadingLibraryKind {
  const runtimeBook = book as ReadingBookWithRuntimeKind;
  return runtimeBook.kind ?? "roman";
}

function defaultMode(kind: ReadingLibraryKind): DisplayMode {
  if (kind === "webtoon") return "vertical";
  if (kind === "roman") return "single";
  return "spread";
}

/** Persistance des préférences utilisateur dans localStorage, par
    profil implicite : les réglages restent entre les sessions. */
const PREF_KEY = "avm-reader-prefs-v1";
interface ReaderPrefs {
  mode: DisplayMode;
  animation: AnimationKind;
  filter: ImageFilter;
  zoom: number; // facteur multiplicateur (1 = auto-fit)
}
const DEFAULT_PREFS: ReaderPrefs = {
  mode: "spread",
  animation: "flip",
  filter: "none",
  zoom: 1,
};
function loadPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}
function savePrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort
  }
}

/** Filtre CSS appliqué aux images selon `ImageFilter`. */
function cssFilter(filter: ImageFilter): string {
  switch (filter) {
    case "bw":
      // N&B contrasté : désaturation + contraste élevé + légère luminosité.
      return "grayscale(1) contrast(1.35) brightness(1.05)";
    case "color":
      // Couleurs boostées : saturation + micro-contraste.
      return "saturate(1.35) contrast(1.08) brightness(1.02)";
    case "none":
    default:
      return "none";
  }
}

export function ReadingBookPage() {
  const { id } = useParams<{ id: string }>();
  const bookId = Number(id);
  const navigate = useNavigate();

  const [book, setBook] = useState<ReadingBook | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadPrefs());
  const [currentPage, setCurrentPage] = useState(0);
  const [uiVisible, setUiVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Cache des URLs de pages déjà chargées (résolution native).
  const [pageCache, setPageCache] = useState<Map<number, string>>(new Map());
  // Animation en cours (pour le curl 3D) : "next" ou "prev".
  const [animDir, setAnimDir] = useState<"next" | "prev" | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const direction = useMemo<"rtl" | "ltr" | "vertical">(
    () =>
      book
        ? prefs.mode === "vertical"
          ? "vertical"
          : defaultDirection(getReadingBookKind(book))
        : "ltr",
    [book, prefs.mode]
  );
  
  /* ----- Chargement initial : livre + progression ----- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [b, p] = await Promise.all([
          readingApi.getBook(bookId),
          readingApi.getProgress(bookId),
        ]);
        if (cancelled) return;
        setBook(b);
        setProgress(p);
        // Applique les défauts liés au type de bibliothèque si l'utilisateur
        // n'a jamais réglé ses préférences (première ouverture).
        const kind = getReadingBookKind(b);
        setPrefs((prev) => ({
          ...prev,
          mode: prev.mode ?? defaultMode(kind),
        }));
        setCurrentPage(p?.current_page ?? 0);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Livre introuvable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  /* ----- Chargement paresseux d'une page ----- */
  const loadPage = useCallback(
    async (index: number): Promise<string | null> => {
      if (!book) return null;
      if (index < 0 || index >= book.page_count) return null;
      setPageCache((cache) => {
        if (cache.has(index)) return cache;
        return cache;
      });
      const existing = pageCache.get(index);
      if (existing) return existing;
      try {
        const path = await readingApi.getPage(bookId, index);
        const url = convertFileSrc(path);
        setPageCache((cache) => {
          const next = new Map(cache);
          next.set(index, url);
          return next;
        });
        return url;
      } catch {
        return null;
      }
    },
    [book, bookId, pageCache]
  );

  /* ----- Préchargement des pages voisines ----- */
  useEffect(() => {
    if (!book) return;
    // Charge la page courante + 2 avant + 2 après pour fluidité.
    const indices: number[] = [];
    for (let i = Math.max(0, currentPage - 2); i <= Math.min(book.page_count - 1, currentPage + 2); i++) {
      indices.push(i);
    }
    void Promise.all(indices.map((i) => loadPage(i)));
  }, [currentPage, book, loadPage]);

  /* ----- Sauvegarde périodique de la progression (toutes les 5 s) ----- */
  useEffect(() => {
    if (!book) return;
    if (saveTimerRef.current !== null) window.clearInterval(saveTimerRef.current);
    saveTimerRef.current = window.setInterval(() => {
      void readingApi.saveProgress(
        bookId,
        currentPage,
        book.page_count,
        currentPage >= book.page_count - 1
      );
    }, 5000);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearInterval(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [book, bookId, currentPage]);

  /* ----- Sauvegarde finale à la fermeture ----- */
  useEffect(() => {
    if (!book) return;
    const onUnload = () => {
      void readingApi.saveProgress(
        bookId,
        currentPage,
        book.page_count,
        currentPage >= book.page_count - 1
      );
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      onUnload(); // sauvegarde immédiate au démontage du composant
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [book, bookId, currentPage]);

  /* ----- Masquage automatique de l'UI après 3 s d'inactivité ----- */
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setUiVisible(false);
      setSettingsOpen(false);
    }, 3000);
  }, []);
  const showUi = useCallback(() => {
    setUiVisible(true);
    scheduleHide();
  }, [scheduleHide]);
  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, [scheduleHide]);

  /* ----- Navigation ----- */
  const goTo = useCallback(
    (index: number, dir: "next" | "prev") => {
      if (!book) return;
      const clamped = Math.max(0, Math.min(book.page_count - 1, index));
      if (clamped === currentPage) return;
      // Déclenche l'animation (sauf mode "none").
      if (prefs.animation !== "none" && prefs.mode !== "vertical") {
        setAnimDir(dir);
        window.setTimeout(() => setAnimDir(null), 550); // durée animation CSS
      }
      setCurrentPage(clamped);
    },
    [book, currentPage, prefs.animation, prefs.mode]
  );

  const goNext = useCallback(() => {
    if (!book) return;
    const step = prefs.mode === "spread" && direction !== "vertical" ? 2 : 1;
    goTo(currentPage + step, "next");
  }, [book, currentPage, prefs.mode, direction, goTo]);

  const goPrev = useCallback(() => {
    if (!book) return;
    const step = prefs.mode === "spread" && direction !== "vertical" ? 2 : 1;
    goTo(currentPage - step, "prev");
  }, [book, currentPage, prefs.mode, direction, goTo]);

  /* ----- Raccourcis clavier ----- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen) return;
      if (e.key === "Escape") {
        navigate(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        direction === "rtl" ? goPrev() : goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        direction === "rtl" ? goNext() : goPrev();
      } else if (e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "h" || e.key === "H") {
        setUiVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goNext, goPrev, direction, settingsOpen]);

  /* ----- Plein écran ----- */
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await stageRef.current?.requestFullscreen();
        setFullscreen(true);
      } else {
        await document.exitFullscreen();
        setFullscreen(false);
      }
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* ----- Rendu ----- */
  if (loading) {
    return (
      <div className="rbk-stage rbk-stage--loading">
        <div className="rbk-loader">
          <BookOpen size={32} />
          <span>Chargement du livre…</span>
        </div>
      </div>
    );
  }
  if (error || !book) {
    return (
      <div className="rbk-stage rbk-stage--error">
        <p className="rbk-error">{error ?? "Livre introuvable."}</p>
        <button type="button" className="rbk-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Retour
        </button>
      </div>
    );
  }

  const totalPages = book.page_count;
  const currentUrl = pageCache.get(currentPage) ?? null;
  // En mode spread, la "page droite" est la suivante (ou précédente en RTL).
  const spreadSecondIndex =
    prefs.mode === "spread" && direction !== "vertical"
      ? direction === "rtl"
        ? currentPage - 1
        : currentPage + 1
      : null;
  const secondUrl =
    spreadSecondIndex !== null && spreadSecondIndex >= 0 && spreadSecondIndex < totalPages
      ? pageCache.get(spreadSecondIndex) ?? null
      : null;

  const pct = totalPages > 0 ? ((currentPage + 1) / totalPages) * 100 : 0;

  // Classe du stage selon le mode et l'animation.
  const stageClasses = [
    "rbk-stage",
    `rbk-stage--${prefs.mode}`,
    `rbk-stage--${direction}`,
    animDir ? `rbk-stage--anim-${animDir}` : "",
    prefs.animation ? `rbk-stage--${prefs.animation}` : "",
    uiVisible ? "" : "rbk-stage--ui-hidden",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={stageRef}
      className={stageClasses}
      onMouseMove={showUi}
      onClick={(e) => {
        // Clic sur la page : zones gauche/droite pour tourner, centre pour toggle UI.
        if ((e.target as HTMLElement).closest(".rbk-ui, .rbk-settings")) {
          return;
        }
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const third = rect.width / 3;
        if (x < third) {
          direction === "rtl" ? goNext() : goPrev();
        } else if (x > 2 * third) {
          direction === "rtl" ? goPrev() : goNext();
        } else {
          setUiVisible((v) => !v);
        }
      }}
    >
      {/* ----- Pages ----- */}
      <div className="rbk-viewport">
        {prefs.mode === "vertical" ? (
          <VerticalReader
            book={book}
            pageCache={pageCache}
            loadPage={loadPage}
            filter={cssFilter(prefs.filter)}
            zoom={prefs.zoom}
            onPageChange={setCurrentPage}
          />
        ) : prefs.mode === "spread" ? (
          <div className="rbk-spread">
            <div
              className="rbk-page rbk-page--left"
              style={{ filter: cssFilter(prefs.filter), transform: `scale(${prefs.zoom})` }}
            >
              {direction === "rtl" ? (
                <PageImage url={secondUrl} index={spreadSecondIndex ?? -1} />
              ) : (
                <PageImage url={currentUrl} index={currentPage} />
              )}
            </div>
            <div
              className="rbk-page rbk-page--right"
              style={{ filter: cssFilter(prefs.filter), transform: `scale(${prefs.zoom})` }}
            >
              {direction === "rtl" ? (
                <PageImage url={currentUrl} index={currentPage} />
              ) : (
                <PageImage url={secondUrl} index={spreadSecondIndex ?? -1} />
              )}
            </div>
          </div>
        ) : (
          <div
            className="rbk-single-wrap"
            style={{ filter: cssFilter(prefs.filter), transform: `scale(${prefs.zoom})` }}
          >
            <PageImage url={currentUrl} index={currentPage} />
          </div>
        )}
      </div>

      {/* ----- UI flottante (barres + panneau de réglages) ----- */}
      <div className={`rbk-ui ${uiVisible ? "rbk-ui--visible" : ""}`}>
        {/* Top bar */}
        <div className="rbk-topbar">
          <button
            type="button"
            className="rbk-icon-btn"
            onClick={() => navigate(-1)}
            title="Quitter le lecteur (Échap)"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="rbk-title">
            <span className="rbk-title__name">{book.title}</span>
            <span className="rbk-title__meta">
              Page {currentPage + 1} / {totalPages}
            </span>
          </div>
          <div className="rbk-topbar__actions">
            <button
              type="button"
              className="rbk-icon-btn"
              onClick={() => setSettingsOpen((o) => !o)}
              title="Réglages"
            >
              <Settings2 size={18} />
            </button>
            <button
              type="button"
              className="rbk-icon-btn"
              onClick={toggleFullscreen}
              title={fullscreen ? "Quitter le plein écran" : "Plein écran (F)"}
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="rbk-bottombar">
          <button
            type="button"
            className="rbk-nav-btn"
            onClick={direction === "rtl" ? goNext : goPrev}
            disabled={direction === "rtl" ? currentPage >= totalPages - 1 : currentPage <= 0}
          >
            ◂ Préc.
          </button>
          <div className="rbk-progress-wrap">
            <input
              type="range"
              className="rbk-progress"
              min={0}
              max={Math.max(0, totalPages - 1)}
              value={currentPage}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCurrentPage(n);
              }}
            />
            <span className="rbk-progress__label">
              {currentPage + 1} / {totalPages}
            </span>
          </div>
          <button
            type="button"
            className="rbk-nav-btn"
            onClick={direction === "rtl" ? goPrev : goNext}
            disabled={direction === "rtl" ? currentPage <= 0 : currentPage >= totalPages - 1}
          >
            Suiv. ▸
          </button>
        </div>
      </div>

      {/* Panneau de réglages */}
      {settingsOpen && (
        <div className="rbk-settings" onClick={(e) => e.stopPropagation()}>
          <div className="rbk-settings__head">
            <span>Réglages de lecture</span>
            <button
              type="button"
              className="rbk-icon-btn"
              onClick={() => setSettingsOpen(false)}
              title="Fermer"
            >
              <X size={16} />
            </button>
          </div>

          <SettingsRow label="Mode d'affichage">
            <Segmented
              options={[
                { value: "single", label: "Page", icon: <Square size={14} /> },
                { value: "spread", label: "Double", icon: <Columns2 size={14} /> },
                { value: "vertical", label: "Scroll", icon: <ScrollText size={14} /> },
              ]}
              value={prefs.mode}
              onChange={(v) => updatePrefs({ mode: v as DisplayMode })}
            />
          </SettingsRow>

          {prefs.mode !== "vertical" && (
            <SettingsRow label="Animation">
              <Segmented
                options={[
                  { value: "flip", label: "Réaliste" },
                  { value: "slide", label: "Glissement" },
                  { value: "fade", label: "Fondu" },
                  { value: "none", label: "Aucune" },
                ]}
                value={prefs.animation}
                onChange={(v) => updatePrefs({ animation: v as AnimationKind })}
              />
            </SettingsRow>
          )}

          <SettingsRow label="Amélioration image">
            <Segmented
              options={[
                { value: "none", label: "Naturel", icon: <Eye size={14} /> },
                { value: "bw", label: "N&B contrasté", icon: <Contrast size={14} /> },
                { value: "color", label: "Couleurs vives", icon: <Palette size={14} /> },
              ]}
              value={prefs.filter}
              onChange={(v) => updatePrefs({ filter: v as ImageFilter })}
            />
          </SettingsRow>

          <SettingsRow label={`Zoom (${Math.round(prefs.zoom * 100)}%)`}>
            <div className="rbk-zoom-row">
              <button
                type="button"
                className="rbk-icon-btn"
                onClick={() => updatePrefs({ zoom: Math.max(0.5, prefs.zoom - 0.1) })}
                title="Réduire"
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                min={50}
                max={200}
                value={Math.round(prefs.zoom * 100)}
                onChange={(e) => updatePrefs({ zoom: Number(e.target.value) / 100 })}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="rbk-icon-btn"
                onClick={() => updatePrefs({ zoom: Math.min(2, prefs.zoom + 0.1) })}
                title="Agrandir"
              >
                <Plus size={14} />
              </button>
            </div>
          </SettingsRow>
        </div>
      )}
    </div>
  );

  function updatePrefs(patch: Partial<ReaderPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }
}

/* ---------- Sous-composants ---------- */

function PageImage({ url, index }: { url: string | null; index: number }) {
  if (!url) {
    return (
      <div className="rbk-placeholder">
        <BookOpen size={28} />
        <span>{index < 0 ? "" : `Page ${index + 1}`}</span>
      </div>
    );
  }
  return <img src={url} alt="" className="rbk-img" draggable={false} />;
}

/** Mode scroll vertical (webtoon) : toutes les pages empilées, la
    navigation se fait au scroll. Un IntersectionObserver remonte la
    page la plus visible pour maintenir la progression à jour. */
function VerticalReader({
  book,
  pageCache,
  loadPage,
  filter,
  zoom,
  onPageChange,
}: {
  book: ReadingBook;
  pageCache: Map<number, string>;
  loadPage: (i: number) => Promise<string | null>;
  filter: string;
  zoom: number;
  onPageChange: (i: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Charge toutes les pages progressivement (lazy).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < book.page_count; i++) {
        if (cancelled) return;
        if (!pageCache.has(i)) await loadPage(i);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book.page_count, loadPage, pageCache]);

  // Observe la page la plus visible.
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let best: { ratio: number; index: number } | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.index);
            if (!best || entry.intersectionRatio > best.ratio) {
              best = { ratio: entry.intersectionRatio, index: idx };
            }
          }
        }
        if (best) onPageChange(best.index);
      },
      { root: containerRef.current, threshold: [0.25, 0.5, 0.75] }
    );
    for (const el of itemRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [book.page_count, pageCache, onPageChange]);

  return (
    <div
      ref={containerRef}
      className="rbk-vertical"
      style={{ filter, transform: `scale(${zoom})`, transformOrigin: "top center" }}
    >
      {Array.from({ length: book.page_count }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          className="rbk-vertical__item"
          data-index={i}
        >
          <PageImage url={pageCache.get(i) ?? null} index={i} />
        </div>
      ))}
    </div>
  );
}

function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rbk-settings__row">
      <span className="rbk-settings__label">{label}</span>
      <div className="rbk-settings__control">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="rbk-segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`rbk-segmented__opt ${value === o.value ? "rbk-segmented__opt--active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}