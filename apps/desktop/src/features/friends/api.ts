import { invoke } from "@tauri-apps/api/core";

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

/** 0.4.0 — Système d'amis et activité de visionnage. */
export const friendsApi = {
  add: (friendProfileId: number) => invoke<void>("add_friend", { friendProfileId }),
  remove: (friendProfileId: number) => invoke<void>("remove_friend", { friendProfileId }),
  list: () => invoke<Friend[]>("list_friends"),
  getActivity: () => invoke<Activity[]>("get_friends_activity"),
  updateActivity: (update: ActivityUpdate) => invoke<void>("update_activity", { update }),
  clearActivity: () => invoke<void>("clear_activity"),
  setVisibility: (visible: boolean) => invoke<void>("set_activity_visibility", { visible }),
  getVisibility: () => invoke<boolean>("get_activity_visibility"),
};