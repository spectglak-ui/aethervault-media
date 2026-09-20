/**
 * Miroir des structs Rust `db::repositories::profile_repository::ProfileRecord`
 * et `security::permissions::ProfilePermissions`.
 *
 * `profile_type` reste une chaîne côté backend (colonne SQLite libre, pas de
 * CHECK) : ce type union documente les valeurs connues par défaut sans les
 * imposer au runtime — un profil "personnalisé" (doc §6.5) peut porter
 * n'importe quelle chaîne.
 */
export type ProfileType = "admin" | "user" | "guest" | "child" | "custom";

export interface ProfilePermissions {
  can_access_private: boolean;
  can_manage_global_settings: boolean;
  can_manage_profiles: boolean;
}

export interface Profile extends ProfilePermissions {
  id: number;
  name: string;
  profile_type: ProfileType;
  created_at: string;
}
