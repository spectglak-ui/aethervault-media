import { invoke } from "@tauri-apps/api/core";

export interface TvChannel {
  id: number;
  name: string;
  url: string;
  logo_url: string | null;
  group_name: string | null;
  country: string | null;
  added_at: number;
}

export const tvApi = {
  listChannels: () => invoke<TvChannel[]>("tv_list_channels"),
  addChannel: (p: { name: string; url: string; logoUrl?: string | null; groupName?: string | null }) =>
    invoke<number>("tv_add_channel", {
      name: p.name,
      url: p.url,
      logoUrl: p.logoUrl ?? null,
      groupName: p.groupName ?? null,
    }),
  removeChannel: (id: number) => invoke<void>("tv_remove_channel", { id }),
  importM3u: (source: string, country?: string) =>
    invoke<number>("tv_import_m3u", { source, country: country ?? null }),
};

/** Playlist publique de référence : flux officiels/gratuits agrégés
    par le projet iptv-org (mis à jour en continu, sans DRM). */
export const IPTV_FR_URL = "https://iptv-org.github.io/iptv/countries/fr.m3u";