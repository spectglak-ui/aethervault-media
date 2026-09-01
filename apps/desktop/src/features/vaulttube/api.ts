import { invoke } from "@tauri-apps/api/core";

export interface VaultTubeSubscription {
  id: number;
  name: string;
  url: string;
  kind: string;
  youtube_id: string;
  thumbnail_url: string | null;
  added_at: number;
  last_synced_at: number | null;
}

export interface VaultTubeVideo {
  id: number;
  subscription_id: number;
  youtube_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: number | null;
  added_at: number;
}

export interface VaultTubePlaylist {
  id: number;
  subscription_id: number;
  youtube_id: string;
  title: string;
  thumbnail_url: string | null;
  video_count: number | null;
  added_at: number;
}

/** Miniature garantie : motif officiel i.ytimg.com si yt-dlp n'a rien fourni. */
export function videoThumb(v: VaultTubeVideo): string {
  return v.thumbnail_url ?? `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`;
}

export const vaultTubeApi = {
  search: (query: string) => invoke<SearchResult[]>("vaulttube_search", { query }),
  listSubscriptions: () => invoke<VaultTubeSubscription[]>("vaulttube_list_subscriptions"),
  listVideos: (subscriptionId: number) =>
    invoke<VaultTubeVideo[]>("vaulttube_list_videos", { subscriptionId }),
  addSubscription: (url: string) =>
    invoke<VaultTubeSubscription>("vaulttube_add_subscription", { url }),
  refreshSubscription: (subscriptionId: number) =>
    invoke<number>("vaulttube_refresh_subscription", { subscriptionId }),
  removeSubscription: (subscriptionId: number) =>
    invoke<void>("vaulttube_remove_subscription", { subscriptionId }),
  listPlaylists: (subscriptionId: number) =>
    invoke<VaultTubePlaylist[]>("vaulttube_list_playlists", { subscriptionId }),
  syncPlaylists: (subscriptionId: number) =>
    invoke<number>("vaulttube_sync_playlists", { subscriptionId }),
  previewVideos: (url: string) => invoke<VaultTubeVideo[]>("vaulttube_preview_videos", { url }),
    // Playlists locales
  createUserPlaylist: (name: string) => invoke<number>("vaulttube_create_user_playlist", { name }),
  listUserPlaylists: () => invoke<UserPlaylist[]>("vaulttube_list_user_playlists"),
  deleteUserPlaylist: (playlistId: number) =>
    invoke<void>("vaulttube_delete_user_playlist", { playlistId }),
  listUserPlaylistItems: (playlistId: number) =>
    invoke<UserPlaylistItem[]>("vaulttube_list_user_playlist_items", { playlistId }),
  addToUserPlaylist: (p: {
    playlistId: number;
    youtubeId: string;
    title: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    channel: string | null;
  }) => invoke<void>("vaulttube_add_to_user_playlist", p),
  removeFromUserPlaylist: (playlistId: number, youtubeId: string) =>
    invoke<void>("vaulttube_remove_from_user_playlist", { playlistId, youtubeId }),
  reorderUserPlaylist: (playlistId: number, itemIds: number[]) =>
    invoke<void>("vaulttube_reorder_user_playlist", { playlistId, itemIds }),
};

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  kind: "video" | "channel" | "playlist";
  thumbnail_url: string | null;
  channel: string | null;
  duration_seconds: number | null;
  video_count: number | null;
}

export interface UserPlaylist {
  id: number;
  name: string;
  created_at: number;
  item_count: number;
}

export interface UserPlaylistItem {
  id: number;
  playlist_id: number;
  youtube_id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  channel: string | null;
  position: number;
  added_at: number;
}