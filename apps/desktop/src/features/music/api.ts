import { invoke } from "@tauri-apps/api/core";
import type { SearchResult } from "../vaulttube/api";

/**
 * AetherFy Musique : catalogue (MusicBrainz) et résolution de lecture (YouTube).
 * Voir `services/music` côté Rust.
 */
export interface MusicArtist {
  /** MBID MusicBrainz. */
  id: string;
  name: string;
  disambiguation: string | null;
  country: string | null;
  kind: string | null;
  active_years: string | null;
}

export interface MusicAlbum {
  /** MBID du « release group » (l'album, toutes éditions confondues). */
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  year: number | null;
  /** `album` | `single` | `ep` | `autre` */
  kind: string;
  /** `Live`, `Compilation`, `Remix`… */
  secondary_types: string[];
  cover_url: string;
}

export interface MusicTrack {
  /** MBID de l'enregistrement. */
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  album: string | null;
  album_id: string | null;
  year: number | null;
  duration_ms: number | null;
  isrc: string | null;
  cover_url: string | null;
  /** Rang dans l'album (page d'un album). */
  position: number | null;
}

export type MusicSearchKind = "track" | "album" | "artist";

export interface MusicSearchResponse {
  kind: string;
  artists: MusicArtist[];
  albums: MusicAlbum[];
  tracks: MusicTrack[];
}

export interface MusicAlbumDetail {
  album: MusicAlbum;
  tracks: MusicTrack[];
}

export interface MusicAlternative {
  video_id: string;
  title: string;
  channel: string;
  duration_s: number | null;
  score: number;
}

export interface MusicResolution {
  track_key: string;
  video_id: string;
  confidence: number;
  cached: boolean;
  verified: boolean;
  alternatives: MusicAlternative[];
}

export const musicApi = {
  search: (kind: MusicSearchKind, query: string) =>
    invoke<MusicSearchResponse>("music_search", { kind, query }),
  artistAlbums: (artistId: string) => invoke<MusicAlbum[]>("music_artist_albums", { artistId }),
  albumTracks: (albumId: string) => invoke<MusicAlbumDetail | null>("music_album_tracks", { albumId }),
  /** Retrouve la vidéo YouTube à jouer pour un titre du catalogue. */
  resolveTrack: (track: Pick<MusicTrack, "id" | "artist" | "title" | "duration_ms">) =>
    invoke<MusicResolution>("music_resolve_track", {
      mbid: track.id,
      artist: track.artist,
      title: track.title,
      durationMs: track.duration_ms,
    }),
  /** Playlists YouTube correspondant à la recherche. */
  searchPlaylists: (query: string) => invoke<SearchResult[]>("music_search_playlists", { query }),
  /** Livres audio : vidéos YouTube d'au moins 30 minutes. */
  searchAudiobooks: (query: string) => invoke<SearchResult[]>("music_search_audiobooks", { query }),
  /** Choix manuel de la version à jouer pour un titre. */
  setMatch: (trackKey: string, videoId: string) =>
    invoke<void>("music_set_match", { trackKey, videoId }),
};

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export const ALBUM_KIND_LABELS: Record<string, string> = {
  album: "Album",
  ep: "EP",
  single: "Single",
  autre: "Autre",
};
