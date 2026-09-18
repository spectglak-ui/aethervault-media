import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Eye, EyeOff, Pencil, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { Avatar, Button, EmptyState, IconButton, PageHeader } from "@aethervault/ui-kit";
import type { Profile } from "@aethervault/shared-types";
import { useActiveProfile } from "../profile/ActiveProfileContext";
import { ProfileFormModal } from "../features/profile/ProfileFormModal";
import { profileApi } from "../features/profile/api";
import { friendsApi, type Friend, type Activity, type RemotePresence } from "../features/friends/api";
import { AddFriendModal } from "../features/friends/AddFriendModal";
import { RemoteFriendCard } from "../features/friends/RemoteFriendCard";
import { FriendCodeModal } from "../features/friends/FriendCodeModal";
import { LibraryCatalogModal } from "../features/friends/LibraryCatalogModal";
import { FriendRequestsNotifier } from "../features/friends/FriendRequestsNotifier";
import "./pages.css";

const TYPE_LABELS: Record<string, string> = {
  admin: "Administrateur",
  user: "Utilisateur",
  guest: "Invité",
  child: "Enfant",
  custom: "Personnalisé",
};

/** 0.4.0 — Formate l'activité d'un ami pour affichage sous son profil. */
function ActivityLine({ activity }: { activity: Activity | null }) {
  if (!activity || !activity.title_name) {
    return (
      <div
        style={{
          fontSize: 12,
          color: "var(--color-text-muted, #9a9aa3)",
          marginTop: 4,
          fontStyle: "italic",
        }}
      >
        Ne regarde rien en ce moment
      </div>
    );
  }
  const progress =
    activity.duration_seconds && activity.duration_seconds > 0
      ? Math.round(
          ((activity.position_seconds ?? 0) / activity.duration_seconds) * 100
        )
      : 0;
  return (
    <div style={{ marginTop: 4, fontSize: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--color-accent, #7c5cff)",
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 10 }}>●</span>
        Regarde actuellement
      </div>
      <div style={{ color: "var(--color-text, #f2f2f5)", marginTop: 2 }}>
        {activity.title_name}
        {activity.category_key && (
          <span style={{ color: "var(--color-text-muted, #9a9aa3)", fontWeight: 400 }}>
            {" "}· {activity.category_key}
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: 4,
          height: 3,
          background: "rgba(255,255,255,.08)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "var(--color-accent, #7c5cff)",
            transition: "width .3s ease",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Gestion complète des profils (Étape 6a, doc §6.5) + système d'amis
 * (0.4.0) : amis locaux avec activité en temps réel, amis distants avec
 * présence et activité, toggle de visibilité de l'activité.
 */
export function ProfilesPage() {
  const { activeProfile, profiles, loading, refresh, switchTo } = useActiveProfile();
  const [formState, setFormState] = useState<{ open: boolean; profile: Profile | null }>({
    open: false,
    profile: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<number | null>(null);

  // 0.4.0 : amis locaux + activité.
  const [friends, setFriends] = useState<Friend[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityVisible, setActivityVisible] = useState(true);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // 0.4.0 : amis distants.
  const [remotePresences, setRemotePresences] = useState<RemotePresence[]>([]);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [libraryTarget, setLibraryTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [pinging, setPinging] = useState(false);

  const canManageProfiles = activeProfile?.can_manage_profiles ?? false;

  const loadFriends = useCallback(async () => {
    if (!activeProfile) return;
    setFriendsLoading(true);
    try {
      const [friendList, activityList, visible] = await Promise.all([
        friendsApi.list(),
        friendsApi.getActivity(),
        friendsApi.getVisibility(),
      ]);
      setFriends(friendList);
      setActivities(activityList);
      setActivityVisible(visible);
    } catch (err) {
      console.warn("[friends] chargement impossible :", err);
    } finally {
      setFriendsLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    loadFriends();
    // Rafraîchit l'activité toutes les 10 s (amis regardent peut-être
    // quelque chose en ce moment).
    const interval = window.setInterval(loadFriends, 10000);
    return () => window.clearInterval(interval);
  }, [loadFriends]);

  // 0.4.0 : ping présence/activité des amis distants toutes les 15 s.
  useEffect(() => {
    const ping = async () => {
      setPinging(true);
      try {
        const p = await friendsApi.pingAll();
        setRemotePresences(p);
      } catch (e) {
        console.warn("[friends] ping en échec :", e);
      } finally {
        setPinging(false);
      }
    };
    ping();
    const interval = window.setInterval(ping, 15000);
    return () => window.clearInterval(interval);
  }, []);

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

  const handleRemoveFriend = async (friend: Friend) => {
    if (!window.confirm(`Retirer « ${friend.name} » de vos amis ?`)) return;
    try {
      await friendsApi.remove(friend.profile_id);
      await loadFriends();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retrait impossible.");
    }
  };

  const handleToggleVisibility = async () => {
    const next = !activityVisible;
    try {
      await friendsApi.setVisibility(next);
      setActivityVisible(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise à jour impossible.");
    }
  };

  const activityByProfile = new Map(activities.map((a) => [a.profile_id, a]));

  return (
    <div>
      <PageHeader
        title="Profils & Amis"
        description="Gérez vos profils locaux et votre liste d'amis pour partager des médias et voir ce qu'ils regardent."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            {canManageProfiles && (
              <Button variant="primary" onClick={() => setFormState({ open: true, profile: null })}>
                <Plus size={16} /> Créer un profil
              </Button>
            )}
          </div>
        }
      />

      {loading && <p>Chargement des profils…</p>}

      {error && (
        <EmptyState icon={<Users size={32} />} title="Une erreur est survenue" description={error} />
      )}

      {/* 0.4.0 : section Amis LOCAUX — visible si un profil actif est défini. */}
      {activeProfile && (
        <section style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              Amis ({friends.length})
            </h2>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant={activityVisible ? "secondary" : "ghost"}
                onClick={handleToggleVisibility}
                title={
                  activityVisible
                    ? "Masquer mon activité aux amis"
                    : "Partager mon activité avec les amis"
                }
              >
                {activityVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                <span style={{ marginLeft: 6, fontSize: 12 }}>
                  {activityVisible ? "Activité visible" : "Activité cachée"}
                </span>
              </Button>
              <Button variant="primary" onClick={() => setAddFriendOpen(true)}>
                <UserPlus size={14} style={{ marginRight: 6 }} />
                Ajouter un ami
              </Button>
            </div>
          </div>

          {friendsLoading && friends.length === 0 ? (
            <p style={{ color: "var(--color-text-muted, #9a9aa3)", fontSize: 13 }}>
              Chargement des amis…
            </p>
          ) : friends.length === 0 ? (
            <EmptyState
              icon={<UserPlus size={32} />}
              title="Aucun ami pour l'instant"
              description="Ajoutez un profil de cette machine à votre liste d'amis pour voir ce qu'il regarde et lui partager des médias facilement."
            />
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              {friends.map((friend) => {
                const friendAvatar = friend.avatar_path
                  ? convertFileSrc(friend.avatar_path)
                  : null;
                const activity = activityByProfile.get(friend.profile_id) ?? null;
                return (
                  <li
                    key={friend.profile_id}
                    style={{
                      padding: 14,
                      border: "1px solid var(--color-border, #2c2c33)",
                      borderRadius: 12,
                      background: "var(--color-surface, #1b1b21)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {friendAvatar ? (
                        <img
                          src={friendAvatar}
                          alt=""
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <Avatar name={friend.name} size={40} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {friend.name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-muted, #9a9aa3)",
                          }}
                        >
                          Ami depuis {new Date(friend.created_at).toLocaleDateString("fr-FR")}
                        </div>
                      </div>
                      <IconButton
                        label={`Retirer ${friend.name} des amis`}
                        onClick={() => handleRemoveFriend(friend)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                    <ActivityLine activity={activity} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* 0.4.0 : section Amis DISTANTS */}
      {activeProfile && (
        <section style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              Amis distants ({remotePresences.length})
            </h2>
            <Button variant="primary" onClick={() => setCodeModalOpen(true)}>
              <UserPlus size={14} style={{ marginRight: 6 }} />
              Code ami distant
            </Button>
          </div>

          {remotePresences.length === 0 ? (
            <EmptyState
              icon={<UserPlus size={32} />}
              title="Aucun ami distant"
              description="Utilise un « code ami » pour appairer un autre utilisateur d'AetherVault Media sur sa propre machine."
            />
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              {remotePresences.map((p) => (
                <li key={p.id}>
                  <RemoteFriendCard
                    presence={p}
                    onOpenLibrary={() =>
                      setLibraryTarget({ id: p.id, name: p.peer_name })
                    }
                    onRemove={async () => {
                      if (!window.confirm(`Retirer ${p.peer_name} de tes amis distants ?`))
                        return;
                      try {
                        await friendsApi.removeRemote(p.id);
                        setRemotePresences((prev) => prev.filter((x) => x.id !== p.id));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Retrait impossible.");
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Section Profils existante. */}
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

      <AddFriendModal
        open={addFriendOpen}
        onClose={() => setAddFriendOpen(false)}
        activeProfileId={activeProfile?.id ?? null}
        existingFriendIds={friends.map((f) => f.profile_id)}
        allProfiles={profiles}
        onAdded={() => {
          setAddFriendOpen(false);
          loadFriends();
        }}
      />

      <FriendCodeModal
        open={codeModalOpen}
        onClose={() => setCodeModalOpen(false)}
        onAdded={() => {
          // Re-ping après ajout.
          friendsApi.pingAll().then(setRemotePresences).catch(() => {});
        }}
      />

      <LibraryCatalogModal
        open={libraryTarget !== null}
        friendId={libraryTarget?.id ?? null}
        friendName={libraryTarget?.name ?? ""}
        onClose={() => setLibraryTarget(null)}
        onRequestSent={(titleName) => {
          // Notification locale optionnelle — peut être branchée sur un toast.
          console.log(`[friends] demande envoyée : ${titleName}`);
        }}
      />

      {/* Notificateur flottant de demandes entrantes */}
      <FriendRequestsNotifier />
    </div>
  );
}