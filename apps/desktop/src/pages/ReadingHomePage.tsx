import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Clock3,
  FolderPlus,
  Library as LibraryIcon,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readingApi, type ContinueReading, type ReadingLibrary, type ReadingLibraryKind } from "../features/reading/api";

const KIND_LABEL: Record<ReadingLibraryKind, string> = {
  manga: "Manga",
  webtoon: "Webtoon",
  bd: "BD",
  roman: "Roman",
  custom: "Personnalisé",
};

const KIND_DESCRIPTION: Record<ReadingLibraryKind, string> = {
  manga: "Sens de lecture japonais (droite → gauche), double page.",
  webtoon: "Scroll vertical continu, format mobile.",
  bd: "Sens de lecture occidental (gauche → droite).",
  roman: "Mode typographique, lecture texte fluide.",
  custom: "Paramètres à définir librement.",
};

function formatProgressLabel(current: number, total: number): string {
  if (total <= 0) return "Commencé";
  const pct = Math.min(100, Math.round((current / total) * 100));
  return `Page ${current} / ${total} · ${pct}%`;
}

export function ReadingHomePage() {
  const navigate = useNavigate();
  const [libraries, setLibraries] = useState<ReadingLibrary[]>([]);
  const [continueList, setContinueList] = useState<ContinueReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [libs, cont] = await Promise.all([
        readingApi.listLibraries(),
        readingApi.listContinue(12),
      ]);
      setLibraries(libs);
      setContinueList(cont);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div style={styles.page}>
      {/* ----- Hero ----- */}
      <div style={styles.hero}>
        <div style={styles.heroGlow} />
        <div style={styles.heroInner}>
          <div style={styles.heroIconWrap}>
            <BookOpen size={28} style={{ color: "#fff" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={styles.heroTitle}>Lecture</h1>
            <p style={styles.heroSub}>
              {libraries.length === 0
                ? "Créez votre première bibliothèque pour commencer à lire."
                : `${libraries.length} bibliothèque${libraries.length > 1 ? "s" : ""} · votre espace de lecture personnel`}
            </p>
          </div>
          <button
            type="button"
            style={styles.heroCta}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={18} strokeWidth={2.4} />
            <span>Nouvelle bibliothèque</span>
          </button>
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {/* ----- Rangée « Continuer à lire » ----- */}
      {continueList.length > 0 && (
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitleWrap}>
              <Clock3 size={16} style={{ color: "var(--color-accent, #7c5cff)" }} />
              <h2 style={styles.sectionTitle}>Continuer à lire</h2>
            </div>
          </div>
          <div style={styles.continueStrip}>
            {continueList.map((entry) => {
              const pct =
                entry.total_pages > 0
                  ? Math.min(100, (entry.current_page / entry.total_pages) * 100)
                  : 0;
              const cover = entry.book.cover_path ? convertFileSrc(entry.book.cover_path) : null;
              return (
                <button
                  key={`continue-${entry.book.id}`}
                  type="button"
                  style={styles.continueCard}
                  onClick={() => navigate(`/reading/book/${entry.book.id}`)}
                  title={`${entry.book.title} · ${formatProgressLabel(entry.current_page, entry.total_pages)}`}
                >
                  <div style={styles.continueCoverWrap}>
                    {cover ? (
                      <img
                        src={cover}
                        alt=""
                        style={styles.continueCover}
                        draggable={false}
                      />
                    ) : (
                      <div style={styles.coverFallback}>
                        <BookOpen size={22} />
                      </div>
                    )}
                    <div style={styles.continueProgressTrack}>
                      <div
                        style={{
                          ...styles.continueProgressFill,
                          width: `${pct}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div style={styles.continueMeta}>
                    <span style={styles.continueTitle}>{entry.book.title}</span>
                    <span style={styles.continueSub}>
                      {formatProgressLabel(entry.current_page, entry.total_pages)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ----- Grille des bibliothèques ----- */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionTitleWrap}>
            <LibraryIcon size={16} style={{ color: "var(--color-accent, #7c5cff)" }} />
            <h2 style={styles.sectionTitle}>Mes bibliothèques</h2>
          </div>
          {libraries.length > 0 && (
            <button
              type="button"
              style={styles.sectionLink}
              onClick={() => setCreateOpen(true)}
            >
              <FolderPlus size={14} />
              Ajouter
            </button>
          )}
        </div>

        {loading ? (
          <p style={styles.muted}>Chargement…</p>
        ) : libraries.length === 0 ? (
          <EmptyLibraries onCreate={() => setCreateOpen(true)} />
        ) : (
          <div style={styles.libraryGrid}>
            {libraries.map((lib) => (
              <LibraryCard key={lib.id} library={lib} onOpen={() => navigate(`/reading/library/${lib.id}`)} />
            ))}
          </div>
        )}
      </section>

      {/* ----- Modale de création ----- */}
      {createOpen && (
        <CreateLibraryModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Sous-composants ---------- */

function LibraryCard({ library, onOpen }: { library: ReadingLibrary; onOpen: () => void }) {
  const accent = library.accent_color ?? "#7c5cff";
  return (
    <button type="button" style={styles.libraryCard} onClick={onOpen}>
      <div
        style={{
          ...styles.libraryBanner,
          background: `linear-gradient(135deg, ${accent}55 0%, ${accent}10 60%, transparent 100%)`,
        }}
      >
        <div style={styles.libraryBadgeRow}>
          <span style={{ ...styles.libraryKindBadge, background: `${accent}22`, color: accent, borderColor: `${accent}55` }}>
            {KIND_LABEL[library.kind as ReadingLibraryKind] ?? library.kind}
          </span>
          <Sparkles size={14} style={{ color: accent, opacity: 0.85 }} />
        </div>
      </div>
      <div style={styles.libraryBody}>
        <div style={styles.libraryTitleRow}>
          <span style={styles.libraryName}>{library.name}</span>
        </div>
        <p style={styles.libraryDesc}>{KIND_DESCRIPTION[library.kind as ReadingLibraryKind] ?? ""}</p>
      </div>
      <div style={styles.libraryFooter}>
        <span style={styles.libraryOpenLabel}>Ouvrir →</span>
      </div>
    </button>
  );
}

function EmptyLibraries({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={styles.empty}>
      <div style={styles.emptyIconWrap}>
        <LibraryIcon size={28} />
      </div>
      <h3 style={styles.emptyTitle}>Aucune bibliothèque pour le moment</h3>
      <p style={styles.emptyDesc}>
        Créez votre première bibliothèque (Manga, Webtoon, BD ou Roman), puis ajoutez un
        dossier contenant vos fichiers (.cbz, .zip) pour commencer à lire.
      </p>
      <button type="button" style={styles.heroCta} onClick={onCreate}>
        <Plus size={18} strokeWidth={2.4} />
        <span>Créer ma première bibliothèque</span>
      </button>
    </div>
  );
}

function CreateLibraryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ReadingLibraryKind>("manga");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Le nom de la bibliothèque ne peut pas être vide.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await readingApi.createLibrary(trimmed, kind);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
      setBusy(false);
    }
  };

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Nouvelle bibliothèque</h2>
          <button type="button" style={styles.modalClose} onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <label style={styles.field}>
          <span style={styles.fieldLabel}>Nom</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mes mangas, Romans policiers, BD franco-belges…"
            style={styles.fieldInput}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>

        <div style={styles.field}>
          <span style={styles.fieldLabel}>Type de bibliothèque</span>
          <div style={styles.kindGrid}>
            {(["manga", "webtoon", "bd", "roman", "custom"] as ReadingLibraryKind[]).map((k) => {
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  style={{
                    ...styles.kindOption,
                    ...(active ? styles.kindOptionActive : null),
                  }}
                  onClick={() => setKind(k)}
                >
                  <span style={styles.kindOptionTitle}>{KIND_LABEL[k]}</span>
                  <span style={styles.kindOptionDesc}>{KIND_DESCRIPTION[k]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.modalActions}>
          <button
            type="button"
            style={styles.ghostBtn}
            onClick={onClose}
            disabled={busy}
          >
            Annuler
          </button>
          <button
            type="button"
            style={styles.primaryBtn}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Création…" : "Créer la bibliothèque"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "28px 40px 80px",
    display: "flex",
    flexDirection: "column",
    gap: 36,
    minHeight: "100%",
  },
  hero: {
    position: "relative",
    borderRadius: 22,
    padding: "32px 36px",
    background: "linear-gradient(135deg, rgba(124,92,255,0.14) 0%, rgba(34,211,238,0.08) 100%)",
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  heroGlow: {
    position: "absolute",
    top: -80,
    right: -80,
    width: 260,
    height: 260,
    background: "radial-gradient(circle, rgba(124,92,255,0.25) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  heroInner: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 20,
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    background: "linear-gradient(135deg, #7c5cff, #22d3ee)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  heroTitle: {
    margin: 0,
    fontSize: 30,
    fontWeight: 800,
    color: "var(--color-text, #f2f2f5)",
    letterSpacing: -0.4,
  },
  heroSub: {
    margin: "4px 0 0",
    fontSize: 14,
    color: "var(--color-text-muted, #9a9aa3)",
  },
  heroCta: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 18px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #7c5cff, #6366f1)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(124,92,255,0.35)",
    flexShrink: 0,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitleWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    color: "var(--color-text, #f2f2f5)",
    letterSpacing: -0.2,
  },
  sectionLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid var(--color-border, #2c2c33)",
    background: "transparent",
    color: "var(--color-text-soft, #cbd5e1)",
    fontSize: 12,
    cursor: "pointer",
  },
  continueStrip: {
    display: "flex",
    gap: 14,
    overflowX: "auto",
    paddingBottom: 6,
  },
  continueCard: {
    flex: "0 0 180px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 0,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  },
  continueCoverWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "2 / 3",
    borderRadius: 12,
    overflow: "hidden",
    background: "#0f0f14",
    border: "1px solid rgba(255,255,255,0.06)",
    boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
  },
  continueCover: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  coverFallback: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--color-text-muted, #64748b)",
    background: "linear-gradient(135deg, #1b1b21, #0f0f14)",
  },
  continueProgressTrack: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    height: 3,
    borderRadius: 2,
    background: "rgba(0,0,0,0.55)",
    overflow: "hidden",
  },
  continueProgressFill: {
    height: "100%",
    borderRadius: 2,
    background: "linear-gradient(90deg, #8b5cf6, #22d3ee)",
  },
  continueMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "0 2px",
  },
  continueTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--color-text, #f2f2f5)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  continueSub: {
    fontSize: 11,
    color: "var(--color-text-muted, #9a9aa3)",
  },
  libraryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 16,
  },
  libraryCard: {
    display: "flex",
    flexDirection: "column",
    padding: 0,
    borderRadius: 18,
    border: "1px solid var(--color-border, #2c2c33)",
    background: "var(--color-surface, #16161c)",
    textAlign: "left",
    cursor: "pointer",
    overflow: "hidden",
    transition: "transform 120ms ease, border-color 120ms ease",
  },
  libraryBanner: {
    position: "relative",
    padding: "20px 18px 14px",
    minHeight: 64,
  },
  libraryBadgeRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  libraryKindBadge: {
    display: "inline-block",
    padding: "3px 9px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    borderRadius: 999,
    border: "1px solid",
  },
  libraryBody: {
    padding: "10px 18px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: 1,
  },
  libraryTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  libraryName: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--color-text, #f2f2f5)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  libraryDesc: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--color-text-muted, #9a9aa3)",
  },
  libraryFooter: {
    padding: "10px 18px 14px",
    borderTop: "1px solid var(--color-border, #2c2c33)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  libraryOpenLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-accent, #7c5cff)",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "48px 24px",
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
  muted: {
    margin: 0,
    fontSize: 13,
    color: "var(--color-text-muted, #9a9aa3)",
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
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    padding: 24,
  },
  modal: {
    width: "100%",
    maxWidth: 520,
    background: "var(--color-surface, #16161c)",
    border: "1px solid var(--color-border, #2c2c33)",
    borderRadius: 18,
    padding: "22px 24px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: "var(--color-text, #f2f2f5)",
  },
  modalClose: {
    background: "transparent",
    border: "none",
    color: "var(--color-text-muted, #9a9aa3)",
    cursor: "pointer",
    padding: 4,
    borderRadius: 6,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text-soft, #cbd5e1)",
    letterSpacing: 0.2,
  },
  fieldInput: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--color-border, #2c2c33)",
    background: "var(--color-bg, #0f0f14)",
    color: "var(--color-text, #f2f2f5)",
    fontSize: 14,
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  kindGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
  },
  kindOption: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--color-border, #2c2c33)",
    background: "var(--color-bg, #0f0f14)",
    color: "var(--color-text-soft, #cbd5e1)",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    transition: "border-color 120ms ease, background 120ms ease",
  },
  kindOptionActive: {
    borderColor: "var(--color-accent, #7c5cff)",
    background: "rgba(124,92,255,0.12)",
  },
  kindOptionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--color-text, #f2f2f5)",
  },
  kindOptionDesc: {
    fontSize: 11,
    lineHeight: 1.4,
    color: "var(--color-text-muted, #9a9aa3)",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  ghostBtn: {
    padding: "9px 16px",
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
    padding: "9px 16px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, #7c5cff, #6366f1)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
};