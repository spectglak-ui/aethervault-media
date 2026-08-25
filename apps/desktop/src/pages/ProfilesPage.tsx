import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { Avatar, Button, EmptyState, IconButton, PageHeader } from "@aethervault/ui-kit";
import type { Profile } from "@aethervault/shared-types";
import { useActiveProfile } from "../profile/ActiveProfileContext";
import { ProfileFormModal } from "../features/profile/ProfileFormModal";
import { profileApi } from "../features/profile/api";
import "./pages.css";

const TYPE_LABELS: Record<string, string> = {
  admin: "Administrateur",
  user: "Utilisateur",
  guest: "Invité",
  child: "Enfant",
  custom: "Personnalisé",
};

/**
 * Gestion complète des profils (Étape 6a, doc §6.5) : la version "sélecteur
 * simple" en lecture seule de l'Étape 1 est remplacée par la bascule de
 * profil actif, la création, le renommage/les permissions et la
 * suppression — ces trois dernières actions réservées à un profil actif
 * disposant de `can_manage_profiles` (masquées, mais de toute façon
 * revérifiées côté Rust à chaque appel, doc §6.5).
 */
export function ProfilesPage() {
  const { activeProfile, profiles, loading, refresh, switchTo } = useActiveProfile();
  const [formState, setFormState] = useState<{ open: boolean; profile: Profile | null }>({
    open: false,
    profile: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<number | null>(null);

  const canManageProfiles = activeProfile?.can_manage_profiles ?? false;

  const handleSwitch = async (profile: Profile) => {
    if (profile.id === activeProfile?.id) return;
    setSwitching(profile.id);
    setError(null);
    try {
      await switchTo(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bascule impossible.");
    } finally {
      setSwitching(null);
    }
  };

  const handleDelete = async (profile: Profile) => {
    if (!window.confirm(`Supprimer le profil « ${profile.name} » ? Son historique de lecture sera perdu.`)) {
      return;
    }
    setError(null);
    try {
      await profileApi.remove(profile.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Profils"
        description="Chaque profil a ses propres favoris, historique de lecture et permissions."
        actions={
          canManageProfiles ? (
            <Button variant="primary" onClick={() => setFormState({ open: true, profile: null })}>
              <Plus size={16} /> Créer un profil
            </Button>
          ) : undefined
        }
      />

      {loading && <p>Chargement des profils…</p>}

      {error && (
        <EmptyState icon={<Users size={32} />} title="Une erreur est survenue" description={error} />
      )}

      {!loading && profiles.length > 0 && (
        <ul className="avm-profile-list">
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfile?.id;
            return (
              <li
                key={profile.id}
                className={`avm-profile-list__item${isActive ? " avm-profile-list__item--active" : ""}`}
              >
                <button
                  type="button"
                  className="avm-profile-list__switch"
                  onClick={() => handleSwitch(profile)}
                  disabled={switching === profile.id}
                >
                  <Avatar name={profile.name} size={40} />
                  <div>
                    <div className="avm-profile-list__name">
                      {profile.name}
                      {isActive && <span className="avm-profile-list__badge">Actif</span>}
                    </div>
                    <div className="avm-profile-list__type">
                      {TYPE_LABELS[profile.profile_type] ?? profile.profile_type}
                    </div>
                  </div>
                </button>

                {canManageProfiles && (
                  <div className="avm-profile-list__actions">
                    <IconButton
                      label="Modifier ce profil"
                      onClick={() => setFormState({ open: true, profile })}
                    >
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton
                      label="Supprimer ce profil"
                      onClick={() => handleDelete(profile)}
                      disabled={isActive}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ProfileFormModal
        open={formState.open}
        profile={formState.profile}
        onClose={() => setFormState({ open: false, profile: null })}
        onSaved={refresh}
      />
    </div>
  );
}
