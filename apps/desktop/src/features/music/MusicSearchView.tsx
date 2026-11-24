import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ListMusic, Play } from "lucide-react";
import { usePlayer } from "../../player/PlayerContext";
import { vaultTubeApi, type SearchResult } from "../vaulttube/api";
import { AlbumCard } from "./AlbumCard";
import { TrackRow } from "./TrackRow";
import {
  errorMessage,
  formatDuration,
  musicApi,
  type MusicAlbum,
  type MusicArtist,
  type MusicTrack,
} from "./api";
import { usePlayTrack } from "./usePlayTrack";
import "./music.css";

export type SearchTab = "all" | "tracks" | "playlists" | "albums" | "artists" | "audiobooks";

const TABS: { tab: SearchTab; label: string }[] = [
  { tab: "all", label: "Tout" },
  { tab: "tracks", label: "Titres" },
  { tab: "playlists", label: "Playlists" },
  { tab: "albums", label: "Albums" },
  { tab: "artists", label: "Artistes" },
  { tab: "audiobooks", label: "Livres audio" },
];

/** Données chargées pour une recherche, par catégorie. */
interface StoreData {
  tracks: MusicTrack[];
  albums: MusicAlbum[];
  artists: MusicArtist[];
  playlists: SearchResult[];
  videos: SearchResult[];
  audiobooks: SearchResult[];
}
type Key = keyof StoreData;
interface Loadable<T> {
  status: "loading" | "ready" | "error";
  data: T;
  error?: string;
}
type Store = { [K in Key]?: Loadable<StoreData[K]> };

/** Catégories à charger pour afficher chaque onglet. */
const NEEDS: Record<SearchTab, Key[]> = {
  all: ["tracks", "artists", "albums", "playlists"],
  tracks: ["tracks", "videos"],
  playlists: ["playlists"],
  albums: ["albums"],
  artists: ["artists"],
  audiobooks: ["audiobooks"],
};

async function load(key: Key, query: string): Promise<StoreData[Key]> {
  switch (key) {
    case "tracks":
      return (await musicApi.search("track", query)).tracks;
    case "albums":
      return (await musicApi.search("album", query)).albums;
    case "artists":
      return (await musicApi.search("artist", query)).artists;
    case "playlists":
      return musicApi.searchPlaylists(query);
    case "videos":
      return (await vaultTubeApi.search(query, "youtube")).filter((r) => r.kind === "video");
    case "audiobooks":
      return musicApi.searchAudiobooks(query);
  }
}

/** Valeur qui ne suit `value` qu'après `delay` ms sans changement. */
function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface MusicSearchViewProps {
  query: string;
  /** Suit une playlist (dans les abonnements de la page Musique) ; `true` si ajoutée. */
  onFollow: (url: string) => Promise<boolean>;
  /** Playlists déjà suivies dans Musique (identifiants YouTube) : affichées « Suivie ». */
  followedPlaylistIds?: ReadonlySet<string>;
}

/**
 * Résultats de recherche d'AetherFy Musique, classés comme sur une application
 * de streaming : Tout, Titres, Playlists, Albums, Artistes, Livres audio.
 * Titres, albums et artistes viennent du catalogue (MusicBrainz) ; playlists,
 * livres audio et vidéos de YouTube.
 */
export function MusicSearchView({ query, onFollow, followedPlaylistIds }: MusicSearchViewProps) {
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const { play: playTrack, busyId, error: playError } = usePlayTrack();
  const [tab, setTab] = useState<SearchTab>("all");
  const q = useDebounced(query.trim(), 600);
  const [state, setState] = useState<{ q: string; data: Store }>({ q: "", data: {} });
  const stateRef = useRef(state);
  stateRef.current = state;
  const inflight = useRef(new Set<string>());
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [following, setFollowing] = useState<string | null>(null);

  const record = (forQuery: string, key: Key, value: Loadable<StoreData[Key]>, init: boolean) =>
    setState((prev) => {
      if (prev.q === forQuery) return { q: forQuery, data: { ...prev.data, [key]: value } };
      // Réponse d'une recherche déjà remplacée : ignorée.
      return init ? { q: forQuery, data: { [key]: value } } : prev;
    });

  useEffect(() => {
    if (!q) return;
    for (const key of NEEDS[tab]) {
      const known = stateRef.current.q === q ? stateRef.current.data[key] : undefined;
      const id = `${q}|${key}`;
      if (known || inflight.current.has(id)) continue;
      inflight.current.add(id);
      record(q, key, { status: "loading", data: [] }, true);
      load(key, q).then(
        (data) => {
          inflight.current.delete(id);
          record(q, key, { status: "ready", data }, false);
        },
        (e) => {
          inflight.current.delete(id);
          record(q, key, { status: "error", data: [], error: errorMessage(e, "Recherche impossible.") }, false);
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab]);

  const data: Store = state.q === q ? state.data : {};
  const get = <K extends Key>(key: K): StoreData[K] => (data[key]?.data ?? []) as StoreData[K];
  const isLoading = (key: Key) => data[key] === undefined || data[key]?.status === "loading";
  const failure = (key: Key) => (data[key]?.status === "error" ? data[key]?.error ?? "Recherche impossible." : null);

  const playWeb = (r: SearchResult) =>
    playQueue([{ id: 0, title: r.title, path: r.url, libraryId: -1, mode: "audio" }], 0);

  const follow = async (r: SearchResult) => {
    if (following) return;
    setFollowing(r.url);
    try {
      if (await onFollow(r.url)) setFollowed((prev) => new Set(prev).add(r.url));
    } finally {
      setFollowing(null);
    }
  };

  /** Message d'attente / d'échec / de vide, ou `null` quand il y a des résultats. */
  const note = (key: Key, emptyText: string): ReactNode => {
    if (get(key).length > 0) return null;
    if (isLoading(key)) return <p className="avm-ms-note">Chargement…</p>;
    return <p className="avm-ms-note">{failure(key) ?? emptyText}</p>;
  };

  const section = (title: string, more: SearchTab | null, body: ReactNode) => (
    <section>
      <div className="avm-ms-section__head">
        <h2>{title}</h2>
        {more && (
          <button type="button" className="avm-ms-link" onClick={() => setTab(more)}>
            Voir tout
          </button>
        )}
      </div>
      {body}
    </section>
  );

  const trackRows = (limit?: number) =>
    note("tracks", "Aucun titre dans le catalogue.") ?? (
      <div className="avm-music-tracks">
        {get("tracks")
          .slice(0, limit)
          .map((t) => (
            <TrackRow key={t.id} track={t} busy={busyId === t.id} onPlay={playTrack} />
          ))}
      </div>
    );

  const webRows = (key: "videos" | "audiobooks", emptyText: string) =>
    note(key, emptyText) ?? (
      <div className="avm-music-tracks">
        {get(key).map((r) => (
          <div
            key={r.id}
            className="avm-ms-web"
            role="button"
            tabIndex={0}
            onClick={() => playWeb(r)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                playWeb(r);
              }
            }}
          >
            <span className="avm-ms-web__thumb">
              {r.thumbnail_url && <img src={r.thumbnail_url} alt="" loading="lazy" />}
            </span>
            <span className="avm-music-track__main">
              <span className="avm-music-track__title">{r.title}</span>
              <span className="avm-music-track__sub">{r.channel ?? ""}</span>
            </span>
            <span className="avm-music-track__duration">
              {formatDuration(r.duration_seconds ? r.duration_seconds * 1000 : null)}
            </span>
            <Play size={16} aria-hidden="true" />
          </div>
        ))}
      </div>
    );

  const artistCards = (limit?: number) =>
    note("artists", "Aucun artiste trouvé.") ?? (
      <div className="avm-ms-artists">
        {get("artists")
          .slice(0, limit)
          .map((a) => (
            <Link key={a.id} className="avm-ms-artist" to={`/vaulttube/music/artist/${a.id}`}>
              <span className="avm-music-avatar" aria-hidden="true">
                {a.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="avm-ms-artist__name">{a.name}</span>
              <span className="avm-ms-artist__sub">
                {[a.kind === "Group" ? "Groupe" : a.kind === "Person" ? "Artiste" : "", a.country]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </Link>
          ))}
      </div>
    );

  const albumGrid = (limit?: number) =>
    note("albums", "Aucun album trouvé.") ?? (
      <div className="avm-music-grid">
        {get("albums")
          .slice(0, limit)
          .map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
      </div>
    );

  const playlistRows = (limit?: number) =>
    note("playlists", "Aucune playlist trouvée.") ?? (
      <div className="avm-music-tracks">
        {get("playlists")
          .slice(0, limit)
          .map((r) => {
            const isFollowed = followed.has(r.url) || (followedPlaylistIds?.has(r.id) ?? false);
            return (
              <div
                key={r.id}
                className="avm-ms-web"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/vaulttube/playlist/${r.id}?mode=audio`)}
              >
                <span className="avm-ms-web__thumb">
                  {r.thumbnail_url ? (
                    <img src={r.thumbnail_url} alt="" loading="lazy" />
                  ) : (
                    <ListMusic size={18} aria-hidden="true" />
                  )}
                </span>
                <span className="avm-music-track__main">
                  <span className="avm-music-track__title">{r.title}</span>
                  <span className="avm-music-track__sub">
                    {[r.channel, r.video_count ? `${r.video_count} titres` : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="avm-ms-web__actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="avm-ms-btn"
                    disabled={isFollowed || following === r.url}
                    onClick={() => void follow(r)}
                  >
                    {isFollowed ? "Suivie" : following === r.url ? "Ajout…" : "Suivre"}
                  </button>
                </span>
              </div>
            );
          })}
      </div>
    );

  const topTrack = get("tracks")[0];

  return (
    <div className="avm-ms">
      <div className="avm-ms-chips" role="tablist" aria-label="Type de résultats">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={tab === t.tab}
            className={`avm-music-tab${tab === t.tab ? " avm-music-tab--active" : ""}`}
            onClick={() => setTab(t.tab)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!q && <p className="avm-ms-note">Saisissez un artiste, un album ou un titre…</p>}
      {playError && <div className="avm-music-error">{playError}</div>}

      {q && tab === "all" && (
        <>
          {topTrack && (
            <section>
              <div className="avm-ms-section__head">
                <h2>Meilleur résultat</h2>
              </div>
              <div
                className="avm-ms-top"
                role="button"
                tabIndex={0}
                onClick={() => void playTrack(topTrack)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void playTrack(topTrack);
                  }
                }}
              >
                <span className="avm-music-cover avm-music-cover--small">
                  {topTrack.cover_url && (
                    <img
                      src={topTrack.cover_url}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </span>
                <span className="avm-music-track__main">
                  <span className="avm-ms-top__title">{topTrack.title}</span>
                  <span className="avm-music-track__sub">
                    Titre · {topTrack.artist}
                    {topTrack.album ? ` · ${topTrack.album}` : ""}
                  </span>
                </span>
                <Play size={20} aria-hidden="true" />
              </div>
            </section>
          )}
          {section("Titres", "tracks", trackRows(5))}
          {section("Artistes", "artists", artistCards(6))}
          {section("Albums", "albums", albumGrid(6))}
          {section("Playlists", "playlists", playlistRows(5))}
        </>
      )}

      {q && tab === "tracks" && (
        <>
          {trackRows()}
          {section("Autres résultats sur YouTube", null, webRows("videos", "Aucune vidéo trouvée."))}
        </>
      )}
      {q && tab === "playlists" && playlistRows()}
      {q && tab === "albums" && albumGrid()}
      {q && tab === "artists" && artistCards()}
      {q && tab === "audiobooks" && (
        <>
          <p className="avm-ms-note">Vidéos YouTube de 30 minutes ou plus correspondant à votre recherche.</p>
          {webRows("audiobooks", "Aucun livre audio trouvé.")}
        </>
      )}
    </div>
  );
}
