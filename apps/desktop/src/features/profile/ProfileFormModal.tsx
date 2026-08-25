import { useEffect, useState, type FormEvent } from "react";
import { Button, Modal } from "@aethervault/ui-kit";
import type { Profile, ProfilePermissions, ProfileType } from "@aethervault/shared-types";
import { profileApi } from "./api";

const TYPE_LABELS: Record<ProfileType, string> = {
  admin: "Administrateur",
  user: "Utilisateur",
  guest: "Invité",
  child: "Enfant",
  custom: "Personnalisé",
};

/** Miroir de `security::permissions::defaults_for` côté Rust — uniquement
 * pour pré-remplir le formulaire de création ; la source de vérité reste
 * le backend, qui recalculerait les mêmes valeurs si `permissions` n'était
 * pas transmis. */
const TYPE_DEFAULT_PERMISSIONS: Record<ProfileType, ProfilePermissions> = {
  admin: { can_access_private: true, can_manage_global_settings: true, can_manage_profiles: true },
  user: { can_access_private: false, can_manage_global_settings: false, can_manage_profiles: false },
  guest: { can_access_private: false, can_manage_global_settings: false, can_manage_profiles: false },
  child: { can_access_private: false, can_manage_global_settings: false, can_manage_profiles: false },
  custom: { can_access_private: false, can_manage_global_settings: false, can_manage_profiles: false },
};

interface ProfileFormModalProps {
  open: boolean;
  /** `null` = création ; sinon édition (nom + permissions uniquement — le
   * type n'est qu'un réglage initial, doc §6.5, jamais modifié ensuite). */
  profile: Profile | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProfileFormModal({ open, profile, onClose, onSaved }: ProfileFormModalProps) {
  const isEditing = profile !== null;
  const [name, setName] = useState("");
  const [profileType, setProfileType] = useState<ProfileType>("user");
  const [permissions, setPermissions] = useState<ProfilePermissions>(TYPE_DEFAULT_PERMISSIONS.user);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (profile) {
      setName(profile.name);
      setProfileType(profile.profile_type);
      setPermissions({
        can_access_private: profile.can_access_private,
        can_manage_global_settings: profile.can_manage_global_settings,
        can_manage_profiles: profile.can_manage_profiles,
      });
    } else {
      setName("");
      setProfileType("user");
      setPermissions(TYPE_DEFAULT_PERMISSIONS.user);
    }
    setError(null);
  }, [open, profile]);

  const handleTypeChange = (nextType: ProfileType) => {
    setProfileType(nextType);
    // Uniquement en création : en édition, changer le libellé de type
    // n'écrase jamais des permissions déjà réglées individuellement.
    if (!isEditing) {
      setPermissions(TYPE_DEFAULT_PERMISSIONS[nextType]);
    }
  };

  const togglePermission = (key: keyof ProfilePermissions) => {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
      if (isEditing && profile) {
        if (trimmed !== profile.name) {
          await profileApi.rename(profile.id, trimmed);
        }
        await profileApi.updatePermissions(profile.id, permissions);
      } else {
        await profileApi.create(trimmed, profileType, permissions);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Modifier le profil" : "Créer un profil"}>
      <form onSubmit={handleSubmit} className="avm-profile-form">
        <label className="avm-form-field">
          <span>Nom</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex. Camille"
            autoFocus
          />
        </label>

        {!isEditing && (
          <label className="avm-form-field">
            <span>Type</span>
            <select
              value={profileType}
              onChange={(event) => handleTypeChange(event.target.value as ProfileType)}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}

        <fieldset className="avm-profile-form__permissions">
          <legend>Permissions</legend>
          <label>
            <input
              type="checkbox"
              checked={permissions.can_access_private}
              onChange={() => togglePermission("can_access_private")}
            />
            Accès à la catégorie Privé
          </label>
          <label>
            <input
              type="checkbox"
              checked={permissions.can_manage_global_settings}
              onChange={() => togglePermission("can_manage_global_settings")}
            />
            Modification des paramètres globaux
          </label>
          <label>
            <input
              type="checkbox"
              checked={permissions.can_manage_profiles}
              onChange={() => togglePermission("can_manage_profiles")}
            />
            Gestion des autres profils
          </label>
        </fieldset>

        {error && <p className="avm-settings-error">{error}</p>}

        <div className="avm-form-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Enregistrement…" : isEditing ? "Enregistrer" : "Créer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
