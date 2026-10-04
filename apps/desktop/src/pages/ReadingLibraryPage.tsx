import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  BookOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  readingApi,
  type ReadingBook,
  type ReadingLibrary,
  type ReadingLibraryKind,
  type ReadingScanSummary,
} from "../features/reading/api";

const KIND_LABEL: Record<ReadingLibraryKind, string> = {
  manga: "Manga",
  webtoon: "Webtoon",
  bd: "BD",
  roman: "Roman",
  custom: "Personnalisé",
};

function describeSummary(summary: ReadingScanSummary): string {
  const parts = [
    `${summary.added} ajouté(s)`,
    `${summary.updated} mis à jour`,
    `${summary.removed} retiré(s)`,
  ];
  return summary.failed > 0 ? `${parts.join(" · ")} · ${summary.failed} ignoré(s)` : parts.join(" · ");
}

export function ReadingLibraryPage() {
  const { id } = useParams<{ id: string }>();
  const libraryId = Number(id);
  const navigate = useNavigate();

  const [library, setLibrary] = useState<ReadingLibrary | null>(null);
  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [libs, bookList] = await Promise.all([
        readingApi.listLibraries(),
        readingApi.listBooks(libraryId),
      ]);
      const found = libs.find((l) => l.id === libraryId) ?? null;
      setLibrary(found);
      setBooks(bookList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAddFolder = async () => {
    // Réutilise le sélecteur natif du projet (libraryApi.pickFolder)
    // via la commande pick_folder déjà exposée — wrapper léger inline.
    setBusy(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = (await invoke<string | null>("pick_folder")) ?? null;
      if (!path) {
        setBusy(false);
        return;
      }
      const summary = await readingApi.addFolder(libraryId, path);
      setLastSummary(describeSummary(summary));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'ajouter ce dossier.");
    } finally {
      setBusy(false);
    }
  };

  const handleScan = async () => {
    setBusy(true);
    setError(null);
    try {
      const summary = await readingApi.scanLibrary(libraryId);
      setLastSummary(describeSummary(summary));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (event: MouseEvent) => {
    event.stopPropagation();
    if (!library) return;
    const next = window.prompt("Nouveau nom", library.name);
    if (!next || next.trim() === library.name) return;
    setBusy(true);
    setError(null);
    try {
      await readingApi.renameLibrary(libraryId, next.trim());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renommage impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (event: MouseEvent) => {
    event.stopPropagation();
    if (!library) return;
    if (!window.confirm(`Supprimer la bibliothèque « ${library.name} » ? Les fichiers présents sur le disque ne seront jamais supprimés.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await readingApi.deleteLibrary(libraryId);
      navigate("/reading");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
      setBusy(false);
    }
  };

  const availableBooks = useMemo(
    () => books.filter((b) => b.is_available),
    [books]
  );

  if (loading) {
    return <div style={styles.page}><p style={styles.muted}>Chargement…</p></div>;
  }
  if (!library) {
    return (
      <div style={styles.page}>
        <p style={styles.error}>Bibliothèque introuvable.</p>
        <Link to="/reading" style={styles.backLink}>← Retour à la lecture</Link>
      </div>
    );
  }

  const accent = library.accent_color ?? "#7c5cff";
  const kindLabel = KIND_LABEL[library.kind as ReadingLibraryKind] ?? library.kind;

  return (
    <div style={styles.page}>
      {/* Fil d'Ariane */}
      <nav style={styles.crumb}>
        <Link to="/reading" style={styles.crumbLink}>
          <ArrowLeft size={14} />
          <span>Lecture</span>
        </Link>
        <span style={styles.crumbSep}>/</span>
        <span style={styles.crumbCurrent}>{library.name}</span>
      </nav>

      {/* En-tête */}
      <div style={styles.head}>
        <div style={styles.headMain}>
          <div
            style={{
              ...styles.headIcon,
              background: `linear-gradient(135deg, ${accent}55, ${accent}10)`,
              borderColor: `${accent}55`,
            }}
          >
            <BookOpen size={22} style={{ color: accent }} />
          </div>
          <div style={styles.headText}>
            <h1 style={styles.headTitle}>{library.name}</h1>
            <p style={styles.headSub}>
              <span style={{ ...styles.kindPill, background: `${accent}22`, color: accent, borderColor: `${accent}55` }}>
                {kindLabel}
              </span>
              <span style={styles.headDot}>·</span>
              <span>{availableBooks.length} livre{availableBooks.length > 1 ? "s" : ""}</span>
            </p>
          </div>
        </div>
        <div style={styles.headActions}>
          <button type="button" style={styles.ghostBtn} onClick={handleAddFolder} disabled={busy}>
            <FolderPlus size={15} />
            Ajouter un dossier
          </button>
          <button type="button" style={styles.ghostBtn} onClick={handleScan} disabled={busy}>
            <RefreshCw size={15} />
            {busy ? "Analyse…" : "Scanner"}
          </button>
          <button type="button" style={styles.iconBtn} onClick={handleRename} title="Renommer" disabled={busy}>
            <Pencil size={15} />
          </button>
          <button type="button" style={styles.iconBtnDanger} onClick={handleDelete} title="Supprimer" disabled={busy}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {lastSummary && !error && <p style={styles.summary}>{lastSummary}</p>}

      {/* Grille */}
      {books.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIconWrap}>
            <FolderPlus size={28} />
          </div>
          <h3 style={styles.emptyTitle}>Aucun livre dans cette bibliothèque</h3>
          <p style={styles.emptyDesc}>
            Ajoutez un dossier contenant vos fichiers <code style={styles.code}>.cbz</code> ou <code style={styles.code}>.zip</code> (ou un dossier d'images),
            puis lancez un scan pour détecter les livres.
          </p>
          <button type="button" style={styles.primaryBtn} onClick={handleAddFolder} disabled={busy}>
            <FolderPlus size={15} />
            Ajouter un dossier
          </button>
        </div>
      ) : (
        <div style={styles.bookGrid}>
          {books.map((book) => (
            <BookCard key={book.id} book={book} onOpen={() => navigate(`/reading/book/${book.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookCard({ book, onOpen }: { book: ReadingBook; onOpen: () => void }) {
  const cover = book.cover_path ? convertFileSrc(book.cover_path) : null;
  return (
    <button type="button" style={styles.bookCard} onClick={onOpen}>
      <div style={styles.bookCoverWrap}>
        {cover ? (
          <img src={cover} alt="" style={styles.bookCover} draggable={false} />
        ) : (
          <div style={styles.bookCoverFallback}>
            <BookOpen size={22} />
            <span>{book.title.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
        {!book.is_available && <span style={styles.unavailableBadge}>Indisponible</span>}
      </div>
      <div style={styles.bookMeta}>
        <span style={styles.bookTitle} title={book.title}>
          {book.title}
        </span>
        <span style={styles.bookSub}>
          {book.page_count > 0 ? `${book.page_count} pages` : "— pages"}
          {book.format ? ` · ${book.format.toUpperCase()}` : ""}
        </span>
      </div>
    </button>
  );
}

/* ---------- Styles ---------- */

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "24px 40px 80px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    minHeight: "100%",
  },
  crumb: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--color-text-muted, #9a9aa3)",
  },
  crumbLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "var(--color-text-soft, #cbd5e1)",
    textDecoration: "none",
  },
  crumbSep: { color: "var(--color-text-muted, #64748b)" },
  crumbCurrent: { color: "var(--color-text, #f2f2f5)", fontWeight: 600 },
  backLink: {
    color: "var(--color-accent, #7c5cff)",
    textDecoration: "none",
    fontSize: 13,
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
  },
  headMain: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minWidth: 0,
    flex: "1 1 auto",
  },
  headIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    border: "1px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headText: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  headTitle: {
    margin: 0,
    fontSize: 24,
    fontWeight: 800,
    color: "var(--color-text, #f2f2f5)",
    letterSpacing: -0.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  headSub: {
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--color-text-muted, #9a9aa3)",
  },
  headDot: { opacity: 0.5 },
  kindPill: {
    display: "inline-block",
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    borderRadius: 999,
    border: "1px solid",
  },
  headActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  ghostBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid var(--color-border, #2c2c33)",
    background: "transparent",
    color: "var(--color-text-soft, #cbd5e1)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  primaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 18px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #7c5cff, #6366f1)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid var(--color-border, #2c2c33)",
    background: "transparent",
    color: "var(--color-text-soft, #cbd5e1)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnDanger: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid rgba(251,113,133,0.25)",
    background: "transparent",
    color: "#fb7185",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    margin: 0,
    padding: "8px 12px",
    borderRadius: 8,
    background: "rgba(251,113,133,0.10)",
    border: "1px solid rgba(251,113,133,0.30)",
    color: "#fb7185",
    fontSize: 13,
  },
  summary: {
    margin: 0,
    padding: "8px 12px",
    borderRadius: 8,
    background: "rgba(124,92,255,0.10)",
    border: "1px solid rgba(124,92,255,0.25)",
    color: "var(--color-text-soft, #cbd5e1)",
    fontSize: 13,
  },
  muted: {
    margin: 0,
    fontSize: 13,
    color: "var(--color-text-muted, #9a9aa3)",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "56px 24px",
    borderRadius: 18,
    border: "1px dashed var(--color-border, #2c2c33)",
    textAlign: "center",
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    background: "rgba(124,92,255,0.12)",
    color: "var(--color-accent, #7c5cff)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    margin: "6px 0 0",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--color-text, #f2f2f5)",
  },
  emptyDesc: {
    margin: 0,
    maxWidth: 460,
    fontSize: 13,
    color: "var(--color-text-muted, #9a9aa3)",
    lineHeight: 1.5,
  },
  code: {
    padding: "1px 5px",
    borderRadius: 4,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid var(--color-border, #2c2c33)",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    color: "var(--color-text-soft, #cbd5e1)",
  },
  bookGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: 20,
  },
  bookCard: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 0,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },
  bookCoverWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "2 / 3",
    borderRadius: 12,
    overflow: "hidden",
    background: "#0f0f14",
    border: "1px solid rgba(255,255,255,0.06)",
    boxShadow: "0 14px 30px rgba(0,0,0,0.5)",
    transition: "transform 150ms ease",
  },
  bookCover: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  bookCoverFallback: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    color: "var(--color-text-muted, #64748b)",
    background: "linear-gradient(135deg, #1b1b21, #0f0f14)",
    fontSize: 40,
    fontWeight: 800,
  },
  unavailableBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.4,
    borderRadius: 999,
    background: "rgba(251,113,133,0.9)",
    color: "#fff",
  },
  bookMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "0 2px",
  },
  bookTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--color-text, #f2f2f5)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    lineHeight: 1.3,
    minHeight: "2.6em",
  },
  bookSub: {
    fontSize: 11,
    color: "var(--color-text-muted, #9a9aa3)",
  },
};