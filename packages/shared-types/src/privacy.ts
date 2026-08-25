/**
 * Miroir de `domain::privacy::VaultStatus` et
 * `db::repositories::private_repository::PrivateLibraryRecord`.
 *
 * Voir doc §6.4/§6.4 bis : `initialized` et `unlocked` sont deux états
 * indépendants — un coffre peut être initialisé mais verrouillé (cas normal
 * à chaque lancement), jamais l'inverse.
 */
export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
}

export type SecretKind = "pin" | "password";

export type PrivateLibraryKind = "images" | "videos";

export interface PrivateLibrary {
  id: number;
  kind: PrivateLibraryKind;
  name: string;
  icon: string | null;
  sort_order: number;
}
