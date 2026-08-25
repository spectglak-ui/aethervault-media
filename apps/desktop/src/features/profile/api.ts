import { invoke } from "@tauri-apps/api/core";
import type { Profile, ProfilePermissions } from "@aethervault/shared-types";

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
};
