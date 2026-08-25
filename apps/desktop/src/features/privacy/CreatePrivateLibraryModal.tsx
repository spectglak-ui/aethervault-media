import { useState, type FormEvent } from "react";
import { Button, Modal } from "@aethervault/ui-kit";
import type { PrivateLibraryKind } from "@aethervault/shared-types";
import { privacyApi } from "./api";

interface CreatePrivateLibraryModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Une bibliothèque privée de l'Étape 6a est un simple conteneur (nom +
 * type Images/Vidéos), sans association de dossier ni scan — voir doc
 * §6.4, encart "Étape 6a (livrée) vs. Étape 6b (à venir)".
 */
export function CreatePrivateLibraryModal({ open, onClose, onCreated }: CreatePrivateLibraryModalProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PrivateLibraryKind>("images");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Le nom est obligatoire.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await privacyApi.createLibrary(kind, trimmed);
      setName("");
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Créer une bibliothèque privée">
      <form onSubmit={handleSubmit} className="avm-create-library-form">
        <label className="avm-form-field">
          <span>Nom</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex. Vacances 2026"
            autoFocus
          />
        </label>

        <label className="avm-form-field">
          <span>Type</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as PrivateLibraryKind)}>
            <option value="images">📷 Images</option>
            <option value="videos">🎞️ Vidéos</option>
          </select>
        </label>

        {error && <p className="avm-settings-error">{error}</p>}

        <div className="avm-form-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Création…" : "Créer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
