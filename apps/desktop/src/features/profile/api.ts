import { invoke } from "@tauri-apps/api/core";
import type { Profile, ProfilePermissions } from "@aethervault/shared-types";
import type { SecretKind } from "./secret";

/**
 * Point d'accès unique aux commandes backend du Profile Manager (doc §6.5).
 * Les pages n'appellent jamais `invoke` directement.
 */
export const profileApi = {
  list: () => invoke<Profile[]>("list_profiles"),

  getActive: () => invoke<Profile>("get_active_profile"),

  /** Ne demande aucune authentification propre — voir doc §6.5. */
  switchActive: (profileId: number) => invoke<Profile>("switch_active_profile", { profileId }),

  create: (name: string, profileType: string, permissions?: ProfilePermissions) =>
    invoke<Profile>("create_profile", { name, profileType, permissions: permissions ?? null }),

  rename: (profileId: number, name: string) => invoke<void>("rename_profile", { profileId, name }),

  updatePermissions: (profileId: number, permissions: ProfilePermissions) =>
    invoke<void>("update_profile_permissions", { profileId, permissions }),

  remove: (profileId: number) => invoke<void>("delete_profile", { profileId }),

  /** Crée un profil AVEC son secret (mot de passe ou PIN), validé avant toute
   * écriture. Renvoie le profil et son code de récupération (à montrer une fois). */
  createWithSecret: (
    name: string,
    profileType: string,
    permissions: ProfilePermissions | undefined,
    secret: string | null,
    secretKind: SecretKind | null
  ) =>
    invoke<[Profile, string | null]>("create_profile_with_secret", {
      name,
      profileType,
      permissions: permissions ?? null,
      secret,
      secretKind,
    }),

  /** Administrateur : définit, remplace ou retire (`secret = null`) le secret d'un
   * compte. Renvoie le nouveau code de récupération. */
  setSecret: (profileId: number, secret: string | null, kind: SecretKind | null) =>
    invoke<string | null>("admin_reset_password", {
      targetProfileId: profileId,
      newPassword: secret,
      kind,
    }),

  /** Compte connecté : change ou retire son propre secret (secret actuel requis). */
  changeOwnSecret: (oldSecret: string | null, newSecret: string | null, kind: SecretKind | null) =>
    invoke<string | null>("change_own_password", {
      oldPassword: oldSecret,
      newPassword: newSecret,
      kind,
    }),
};
