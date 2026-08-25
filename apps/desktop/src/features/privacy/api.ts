import { invoke } from "@tauri-apps/api/core";
import type { PrivateLibrary, PrivateLibraryKind, SecretKind, VaultStatus } from "@aethervault/shared-types";

/**
 * Point d'accès unique aux commandes backend du Privacy/Security Manager
 * (doc §6.4/§6.4 bis). Les pages n'appellent jamais `invoke` directement.
 */
export const privacyApi = {
  getVaultStatus: () => invoke<VaultStatus>("get_vault_status"),

  setupVault: (secretKind: SecretKind, secret: string) =>
    invoke<VaultStatus>("setup_vault", { secretKind, secret }),

  unlockVault: (secret: string) => invoke<VaultStatus>("unlock_vault", { secret }),

  lockVault: () => invoke<VaultStatus>("lock_vault"),

  changeVaultSecret: (secretKind: SecretKind, newSecret: string) =>
    invoke<void>("change_vault_secret", { secretKind, newSecret }),

  listLibraries: () => invoke<PrivateLibrary[]>("list_private_libraries"),

  createLibrary: (kind: PrivateLibraryKind, name: string) =>
    invoke<PrivateLibrary>("create_private_library", { kind, name }),

  renameLibrary: (libraryId: number, name: string) =>
    invoke<void>("rename_private_library", { libraryId, name }),

  removeLibrary: (libraryId: number) => invoke<void>("delete_private_library", { libraryId }),
};
