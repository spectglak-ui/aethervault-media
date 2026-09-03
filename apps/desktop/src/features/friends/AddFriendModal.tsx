import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { Avatar, Button, Modal } from "@aethervault/ui-kit";
import type { Profile } from "@aethervault/shared-types";
import { friendsApi } from "./api";

interface AddFriendModalProps {
  open: boolean;
  onClose: () => void;
  activeProfileId: number | null;
  existingFriendIds: number[];
  allProfiles: Profile[];
  onAdded: () => void;
}

/**
 * 0.4.0 — Modal d'ajout d'ami : recherche dans les profils locaux,
 * ajout en un clic. Les profils déjà amis et le profil actif sont
 * masqués pour éviter les doublons et l'auto-amitié.
 */
export function AddFriendModal({
  open,
  onClose,
  activeProfileId,
  existingFriendIds,
  allProfiles,
  onAdded,
}: AddFriendModalProps) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setError(null);
      setAdding(null);
    }
  }, [open]);

  const availableProfiles = allProfiles.filter(
    (p) =>
      p.id !== activeProfileId &&
      !existingFriendIds.includes(p.id) &&
      (query.trim() === "" ||
        p.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  const handleAdd = async (profileId: number) => {
    setAdding(profileId);
    setError(null);
    try {
      await friendsApi.add(profileId);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajout impossible.");
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Ajouter un ami">
      <p style={{ marginTop: 0 }}>
        Recherchez un profil existant sur cette machine pour l'ajouter à votre
        liste d'amis. Vous pourrez voir ce qu'il regarde (s'il partage son
        activité) et lui partager des médias facilement.
      </p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher un profil par nom…"
        autoFocus
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid var(--color-border, #2c2c33)",
          borderRadius: 8,
          background: "var(--color-bg, #0f0f14)",
          color: "var(--color-text, #f2f2f5)",
          fontSize: 14,
          marginTop: 8,
        }}
      />
      <div
        style={{
          marginTop: 12,
          maxHeight: 320,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {availableProfiles.length === 0 && (
          <p
            style={{
              color: "var(--color-text-muted, #9a9aa3)",
              fontSize: 13,
              padding: "12px 4px",
              textAlign: "center",
            }}
          >
            {query.trim()
              ? "Aucun profil ne correspond."
              : "Tous les profils sont déjà dans votre liste d'amis."}
          </p>
        )}
        {availableProfiles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleAdd(p.id)}
            disabled={adding !== null}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              border: "none",
              borderRadius: 8,
              background: "transparent",
              color: "var(--color-text, #f2f2f5)",
              cursor: "pointer",
              font: "inherit",
              textAlign: "left",
              transition: "background .15s ease",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background =
                "color-mix(in srgb, var(--color-accent, #7c5cff) 14%, transparent)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Avatar name={p.name} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted, #9a9aa3)",
                }}
              >
                Profil #{p.id}
              </div>
            </div>
            <UserPlus
              size={16}
              style={{
                opacity: adding === p.id ? 0.4 : 0.8,
                color: "var(--color-accent, #7c5cff)",
              }}
            />
          </button>
        ))}
      </div>
      {error && (
        <p style={{ color: "#ff6464", fontSize: 13, marginTop: 8 }}>{error}</p>
      )}
      <div className="avm-form-actions">
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </Modal>
  );
}