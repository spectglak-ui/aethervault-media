import { useEffect, useState } from "react";
import { Button, Modal } from "@aethervault/ui-kit";
import { friendsApi, type CatalogItem } from "./api";

interface Props {
  open: boolean;
  friendId: number | null;
  friendName: string;
  onClose: () => void;
  onRequestSent: (titleName: string) => void;
}

/** Mapping catégorie locale → clé d'affichage. */
const CATEGORY_MAP: Record<string, { key: string; label: string }> = {
  Film: { key: "Film", label: "Films" },
  Série: { key: "Série", label: "Séries" },
  Animé: { key: "Animé", label: "Animés" },
  Documentaire: { key: "Documentaire", label: "Documentaires" },
};

const CATEGORIES = ["Film", "Série", "Animé", "Documentaire"];

/** URL TMDB pour un poster depuis son path (ou placeholder). */
function posterUrl(path: string | null): string | null {
  if (!path) return null;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `https://image.tmdb.org/t/p/w300${clean}`;
}

export function LibraryCatalogModal({
  open,
  friendId,
  friendName,
  onClose,
  onRequestSent,
}: Props) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("Film");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || friendId === null) return;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setActiveCategory("Film");
    friendsApi
      .fetchCatalog(friendId)
      .then((list) => setItems(list))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Catalogue inaccessible.")
      )
      .finally(() => setLoading(false));
  }, [open, friendId]);

  // Classe les titres par catégorie (tolérant aux variations de nom).
  const classify = (it: CatalogItem): string => {
    const k = (it.category_name || "").toLowerCase();
    if (k.includes("film") || k.includes("movie")) return "Film";
    if (k.includes("anim") || k.includes("anime")) return "Animé";
    if (k.includes("docu")) return "Documentaire";
    if (k.includes("sér") || k.includes("ser") || k.includes("tv") || k.includes("series"))
      return "Série";
    return "Film"; // fallback
  };

  const filtered = items.filter((it) => classify(it) === activeCategory);
  const selectedItem = selectedId !== null ? items.find((i) => i.title_id === selectedId) ?? null : null;

  const handleSendRequest = async () => {
    if (!selectedItem || friendId === null) return;
    setSending(true);
    try {
      await friendsApi.sendRequest(friendId, selectedItem);
      onRequestSent(selectedItem.name);
      setSelectedId(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bibliothèque de ${friendName}`}
    >
      <p style={{ marginTop: 0, fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
        Parcoure la bibliothèque de ton ami. Sélectionne un média puis clique
        sur « Demander » pour lui envoyer une demande.
      </p>

      {/* Onglets catégories */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {CATEGORIES.map((c) => {
          const count = items.filter((i) => classify(i) === c).length;
          const active = c === activeCategory;
          return (
            <button
              key={c}
              type="button"
              onClick={() => {
                setActiveCategory(c);
                setSelectedId(null);
              }}
              style={{
                padding: "6px 12px",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                font: "inherit",
                fontSize: 12,
                background: active ? "var(--color-accent, #7c5cff)" : "var(--color-bg, #0f0f14)",
                color: active ? "#fff" : "var(--color-text-muted, #9a9aa3)",
              }}
            >
              {CATEGORY_MAP[c].label}
              <span
                style={{
                  marginLeft: 6,
                  opacity: 0.7,
                  fontSize: 10,
                }}
              >
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {loading && (
        <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
          Chargement du catalogue…
        </p>
      )}

      {error && <p style={{ color: "#ff6464", fontSize: 13 }}>{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
          Aucun média dans cette catégorie.
        </p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 10,
            maxHeight: 380,
            overflowY: "auto",
            padding: 2,
          }}
        >
          {filtered.map((it) => {
            const isSelected = selectedId === it.title_id;
            const url = posterUrl(it.poster_path);
            return (
              <button
                key={it.title_id}
                type="button"
                onClick={() => setSelectedId(isSelected ? null : it.title_id)}
                style={{
                  padding: 0,
                  border: "2px solid",
                  borderColor: isSelected
                    ? "var(--color-accent, #7c5cff)"
                    : "transparent",
                  borderRadius: 10,
                  background: "transparent",
                  cursor: "pointer",
                  overflow: "hidden",
                  boxShadow: isSelected
                    ? "0 0 0 3px color-mix(in srgb, var(--color-accent, #7c5cff) 35%, transparent)"
                    : "none",
                  transition: "all .15s ease",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "2 / 3",
                    background: url
                      ? `url(${url}) center/cover no-repeat`
                      : "linear-gradient(135deg, #2c2c33 0%, #1b1b21 100%)",
                    position: "relative",
                  }}
                >
                  {!url && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 6,
                        textAlign: "center",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#fff",
                      }}
                    >
                      {it.name}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    padding: "6px 8px",
                    textAlign: "center",
                    background: "var(--color-surface, #1b1b21)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {it.name}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Bouton Demander flottant */}
      {selectedItem && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "color-mix(in srgb, var(--color-accent, #7c5cff) 12%, var(--color-surface, #1b1b21))",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedItem.name}</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-muted, #9a9aa3)",
                marginTop: 2,
              }}
            >
              {CATEGORY_MAP[classify(selectedItem)]?.label ?? "—"}
            </div>
          </div>
          <Button
            variant="primary"
            onClick={handleSendRequest}
            disabled={sending}
          >
            {sending ? "Envoi…" : "Demander"}
          </Button>
        </div>
      )}
    </Modal>
  );
}