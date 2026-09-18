import { invoke } from "@tauri-apps/api/core";

// --- Amis locaux (0.4.0) ---
export interface Friend {
  profile_id: number;
  name: string;
  avatar_path: string | null;
  created_at: string;
}

export interface Activity {
  profile_id: number;
  profile_name: string;
  profile_avatar: string | null;
  title_id: number | null;
  title_name: string | null;
  poster: string | null;
  category_key: string | null;
  position_seconds: number | null;
  duration_seconds: number | null;
  updated_at: string | null;
}

export interface ActivityUpdate {
  title_id: number | null;
  title_name: string | null;
  poster: string | null;
  category_key: string | null;
  position_seconds: number | null;
  duration_seconds: number | null;
}

// --- Amis distants (0.4.0) ---
export interface RemoteFriend {
  id: number;
  peer_name: string;
  host: string;
  port: number;
  last_seen: string | null;
}

export interface RemotePresence {
  id: number;
  peer_name: string;
  online: boolean;
  activity: {
    title_name: string | null;
    category_key: string | null;
    position_seconds: number | null;
    duration_seconds: number | null;
  } | null;
}

export interface CatalogItem {
  title_id: number;
  name: string;
  kind: string;
  category_name: string;
  tmdb_id: number | null;
}

export interface FriendRequest {
  id: number;
  friend_name: string;
  title_name: string;
  tmdb_id: number | null;
  media_type: string | null;
  poster_path: string | null;
  status: string;
}

/** 0.4.0 — Système d'amis (locaux + distants) et activité de visionnage. */
export const friendsApi = {
  // --- Amis locaux ---
  add: (friendProfileId: number) => invoke<void>("add_friend", { friendProfileId }),
  remove: (friendProfileId: number) => invoke<void>("remove_friend", { friendProfileId }),
  list: () => invoke<Friend[]>("list_friends"),
  getActivity: () => invoke<Activity[]>("get_friends_activity"),
  updateActivity: (update: ActivityUpdate) => invoke<void>("update_activity", { update }),
  clearActivity: () => invoke<void>("clear_activity"),
  setVisibility: (visible: boolean) => invoke<void>("set_activity_visibility", { visible }),
  getVisibility: () => invoke<boolean>("get_activity_visibility"),

  // --- Amis DISTANTS (0.4.0) ---
  generateCode: () => invoke<string>("friends_generate_code"),
  addByCode: (code: string) => invoke<RemoteFriend>("friends_add_by_code", { code }),
  listRemote: () => invoke<RemoteFriend[]>("friends_list_remote"),
  removeRemote: (id: number) => invoke<void>("friends_remove_remote", { id }),
  pingAll: () => invoke<RemotePresence[]>("friends_ping_all"),
  fetchCatalog: (friendId: number) => invoke<CatalogItem[]>("friends_fetch_catalog", { friendId }),
  sendRequest: (friendId: number, item: CatalogItem) =>
    invoke<void>("friends_send_request", { friendId, item }),
  listRequests: () => invoke<FriendRequest[]>("friends_list_requests"),
  setRequestStatus: (id: number, status: string) =>
    invoke<void>("friends_set_request_status", { id, status }),
};

export interface CatalogItem {
  title_id: number;
  name: string;
  kind: string;
  category_name: string;
  tmdb_id: number | null;
  poster_path: string | null;  // ← AJOUT
}