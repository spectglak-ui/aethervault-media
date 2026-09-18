import { useState, type FormEvent } from "react";
import { Button, Modal } from "@aethervault/ui-kit";
import { libraryApi } from "./api";

interface CreateLibraryModalProps {
  open: boolean;
  /** La bibliothèque créée est toujours rattachée à cette catégorie (doc
   * §6.1) — cette modale s'ouvre depuis une `CategoryPage` précise,
   * jamais depuis un contexte ambigu, donc pas de sélecteur de catégorie
   * ici : la catégorie est déjà déterminée par où l'utilisateur se
   * trouve. */
  categoryId: number;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateLibraryModal({ open, categoryId, onClose, onCreated }: CreateLibraryModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Le nom est obligatoire.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await libraryApi.create({ name: trimmedName, categoryId });
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
    <Modal open={open} onClose={onClose} title="Créer une bibliothèque">
      <form onSubmit={handleSubmit} className="avm-create-library-form">
        <label className="avm-form-field">
          <span>Nom</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex. Mes films d'animation"
            autoFocus
          />
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
