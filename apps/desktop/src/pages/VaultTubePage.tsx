import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  ListVideo,
  Music,
  Play,
  Plus,
  Radio,
  Search,
  Trash2,
  UserCircle2,
  Video,
} from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import {
  vaultTubeApi,
  watchUrl,
  type PlaybackMode,
  type SearchResult,
  type UserPlaylist,
  type VaultTubeSubscription,
  type VaultTubeVideo,
} from "../features/vaulttube/api";
import { usePlayer } from "../player/PlayerContext";
import { formatDuration } from "./VaultTubeVideoGrid";
import { VaultTubePlaylistPicker, type PickableVideo } from "../components/VaultTubePlaylistPicker";
import "./pages.css";
import { ModernPageHeader } from "../components/ModernPageHeader";
import "../features/aetherfy/aetherfy-modern.css";
// 0.8.0 — AetherFy Musique : interface premium (panneaux de verre).
import {
  MusicHub,
  type MusicPlaylist,
  type MusicSource,
  type MusicSubscription,
  type MusicTrack,
} from "../features/aetherfy/MusicHub";
import "../features/aetherfy/musicHub.css";

const inputStyle: CSSProperties = {
  flex: 1,
  background: "#131318",
  border: "1px solid #2a2a32",
  borderRadius: 8,
  color: "#e8e8ec",
  padding: "9px 12px",
  fontSize: 13,
  outline: "none",
};

const SOURCE_COLORS: Record<string, string> = {
  youtube: "#ff4d6d",
  dailymotion: "#00aaff",
  vimeo: "#1ab7ea",
  peertube: "#f1680d",
  generic: "#9a9aa3",
};

function SourceBadge({ source }: { source?: string }) {
  const s = source ?? "youtube";
  const c = SOURCE_COLORS[s] ?? "#9a9aa3";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        background: `${c}22`,
        color: c,
        border: `1px solid ${c}55`,
      }}
    >
      {s}
    </span>
  );
}

/** Badge indiquant le mode de lecture d'une carte (musique / vidéo). */
function ModeBadge({ mode }: { mode?: string }) {
  const audio = mode === "audio";
  return (
    <span
      title={audio ? "Mode musique (interface Spotify)" : "Mode vidéo (interface YouTube)"}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        background: audio ? "rgba(29,185,84,.20)" : "rgba(124,92,255,.20)",
        color: audio ? "#1db954" : "#c4b5ff",
        border: `1px solid ${audio ? "rgba(29,185,84,.45)" : "rgba(124,92,255,.45)"}`,
      }}
    >
      {audio ? <Music size={10} /> : <Video size={10} />}
      {audio ? "Musique" : "Vidéo"}
    </span>
  );
}

/** Carte carrée façon Spotify : vignette 1:1, badges source/mode,
bouton play rond et bascule de mode au survol. */
function AetherCard({
  title,
  subtitle,
  image,
  source,
  mode,
  onOpen,
  onPlayAll,
  onToggleMode,
  onRemove,
}: {
  title: string;
  subtitle: string;
  image: string | null;
  source?: string;
  mode?: string;
  onOpen: () => void;
  onPlayAll?: () => void;
  onToggleMode?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className="avm-af-card"
      onClick={onOpen}
      style={{
        background: "#181818",
        borderRadius: 8,
        padding: 12,
        cursor: "pointer",
        transition: "background .2s ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#242424")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "#181818")}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "1/1",
          borderRadius: 6,
          overflow: "hidden",
          background: "#000",
          marginBottom: 10,
        }}
      >
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #241b4d, #12101c)",
            }}
          >
            <ListVideo size={44} style={{ opacity: 0.5 }} />
          </div>
        )}
        {source && (
          <span style={{ position: "absolute", top: 6, left: 6 }}>
            <SourceBadge source={source} />
          </span>
        )}
        {onRemove && (
          <button
            className="avm-af-card__remove"
            title="Supprimer"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "rgba(0,0,0,.78)",
              border: "1px solid rgba(255,255,255,.22)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              opacity: 0,
              transition: "opacity .15s ease, background .15s ease",
              zIndex: 2,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(220,38,38,.85)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,0,0,.78)")}
          >
            <Trash2 size={13} />
          </button>
        )}
        {mode && <ModeBadge mode={mode} />}
        {onToggleMode && (
          <button
            className="avm-af-card__mode"
            title={mode === "audio" ? "Basculer en mode vidéo" : "Basculer en mode musique"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMode();
            }}
            style={{
              position: "absolute",
              left: 8,
              bottom: 8,
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "rgba(0,0,0,.78)",
              border: "1px solid rgba(255,255,255,.22)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              opacity: 0,
              transition: "opacity .15s ease",
              zIndex: 2,
            }}
          >
            {mode === "audio" ? <Video size={15} /> : <Music size={15} />}
          </button>
        )}
        {onPlayAll && (
          <button
            className="avm-af-card__play"
            title="Tout lire"
            onClick={(e) => {
              e.stopPropagation();
              onPlayAll();
            }}
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: "var(--color-accent, #7c5cff)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              opacity: 0,
              transform: "translateY(6px)",
              transition: "opacity .15s ease, transform .15s ease",
              boxShadow: "0 4px 12px rgba(0,0,0,.5)",
            }}
          >
            <Play size={18} fill="#fff" color="#fff" />
          </button>
        )}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 14,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-text-muted, #9a9aa3)",
          marginTop: 3,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 16,
};

const sectionTitle: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  margin: "26px 0 14px",
};

/**
FONCTIONNALITÉ (refonte UI AetherFy, Phase 1 — séparation navigation) :
`defaultMode` filtre l'affichage sur les chaînes/playlists de ce mode
(`sub.mode`/`p.mode`, déjà stocké par élément — aucun changement
backend nécessaire). `undefined` = comportement d'origine, tout
confondu (route `/vaulttube` historique, conservée pour compatibilité
des liens existants). Voir `router.tsx` (`/vaulttube/video`,
`/vaulttube/music`) et `layout/Sidebar.tsx` pour les deux nouvelles
entrées de navigation.
0.8.0 : le mode "audio" rend désormais le hub premium `MusicHub`
(panneaux de verre, héro, rail « lecture en cours ») ; les modes
"video" et mixte conservent EXACTEMENT l'ancien rendu.
*/
export interface VaultTubePageProps {
  defaultMode?: PlaybackMode;
}

/** 0.8.0 — resserre toute source vers l'union attendue par MusicHub. */
function toMusicSource(source: string): "youtube" | "dailymotion" {
  return source === "dailymotion" ? "dailymotion" : "youtube";
}

/** 0.8.0 — devine l'artiste depuis un titre « Artiste - Titre » (les
playlists musicales multi-artistes ne stockent pas le canal par
vidéo ; `channel` contient alors le propriétaire de la playlist,
ex. « Spectglack S »). Gère les préfixes type « RÉACTION | Artiste - … ». */
function guessArtist(title: string, fallback: string): string {
  const afterPipe = title.includes("|") ? title.slice(title.lastIndexOf("|") + 1) : title;
  const m = afterPipe.match(/^\s*(.+?)\s+[-–—]\s+/);
  const candidate = (m?.[1] ?? "").trim();
  if (candidate.length >= 2 && candidate.length <= 60) return candidate;
  return fallback;
}

/** 0.8.0 — pochettes HD : CDN image YouTube (maxres 1280×720, repli
hqdefault 480×360 si maxres n'existe pas pour la vidéo). */
function youtubeCovers(
  source: string,
  youtubeId: string | null,
  stored: string | null
): { cover: string | null; coverFallback: string | null } {
  if (source !== "youtube" || !youtubeId) return { cover: stored, coverFallback: null };
  return {
    cover: `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
    coverFallback: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
  };
}

/** 0.4.0 — AetherFy : hub multi-sources façon Spotify (YouTube,
Dailymotion, Vimeo, PeerTube) — abonnements, playlists locales avec
mode musique/vidéo, recherche unifiée, lecture en un clic. */
export function VaultTubePage({ defaultMode }: VaultTubePageProps) {
  const navigate = useNavigate();
  // 0.8.0 — champs RÉELS du PlayerContextValue (l'ancien cast
  // « PlayerExtras » pointait vers des champs inexistants : le rail
  // Lecteur du hub restait mort et la progression ne s'affichait pas).
  const {
    playQueue,
    currentMedia,
    isPlaying,
    position,
    duration,
    togglePlay,
    playNext,
    playPrevious,
  } = usePlayer();
  const [subscriptions, setSubscriptions] = useState<VaultTubeSubscription[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<UserPlaylist[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [newPlaylist, setNewPlaylist] = useState("");
  const [newPlaylistMode, setNewPlaylistMode] = useState<PlaybackMode>(defaultMode ?? "video");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSource, setSearchSource] = useState<"all" | "youtube" | "dailymotion">("all");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pickerVideo, setPickerVideo] = useState<PickableVideo | null>(null);
  // 0.8.0 — vidéos des abonnements musicaux (liste principale du hub).
  const [audioVideos, setAudioVideos] = useState<VaultTubeVideo[]>([]);

  const refresh = useCallback(() => {
    vaultTubeApi.listSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
    vaultTubeApi.listUserPlaylists().then(setUserPlaylists).catch(() => setUserPlaylists([]));
  }, []);

  // FONCTIONNALITÉ (Phase 1) : pré-filtrage local sur `mode` — les
  // données ne changent pas, seul l'affichage est restreint.
  const visibleSubscriptions = defaultMode
    ? subscriptions.filter((s) => s.mode === defaultMode)
    : subscriptions;
  const visibleUserPlaylists = defaultMode
    ? userPlaylists.filter((p) => p.mode === defaultMode)
    : userPlaylists;

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 0.8.0 — charge les vidéos des abonnements du mode audio uniquement.
  useEffect(() => {
    if (defaultMode !== "audio") return;
    let alive = true;
    const subs = subscriptions.filter((s) => s.mode === "audio");
    if (subs.length === 0) {
      setAudioVideos([]);
      return;
    }
    Promise.all(subs.map((s) => vaultTubeApi.listVideos(s.id).catch(() => [] as VaultTubeVideo[])))
      .then((lists) => {
        if (alive) setAudioVideos(lists.flat());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [subscriptions, defaultMode]);

  // Recherche debounced multi-sources
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      vaultTubeApi
        .search(q, searchSource)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 500);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery, searchSource]);

  const handleAdd = async () => {
    const url = newUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    setError(null);
    try {
      await vaultTubeApi.addSubscription(url);
      setNewUrl("");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  // 0.8.0 — suivi par URL fourni directement par le hub musique.
  const handleFollowUrl = async (url: string) => {
    setAdding(true);
    setError(null);
    try {
      await vaultTubeApi.addSubscription(url);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleCreatePlaylist = async () => {
    const name = newPlaylist.trim();
    if (!name) return;
    await vaultTubeApi.createUserPlaylist(name, newPlaylistMode);
    setNewPlaylist("");
    refresh();
  };

  const handleRefresh = async (id: number) => {
    setBusyId(id);
    try {
      await vaultTubeApi.refreshSubscription(id);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id: number) => {
    if (!window.confirm("Supprimer cet abonnement et toutes ses vidéos ?")) return;
    await vaultTubeApi.removeSubscription(id);
    refresh();
  };

  const handleDeletePlaylistFromGrid = async (id: number, name: string) => {
    if (!window.confirm(`Supprimer la playlist « ${name} » ?`)) return;
    await vaultTubeApi.deleteUserPlaylist(id);
    refresh();
  };

  const handleToggleSubMode = async (sub: VaultTubeSubscription) => {
    const next: PlaybackMode = sub.mode === "audio" ? "video" : "audio";
    await vaultTubeApi.setSubscriptionMode(sub.id, next);
    refresh();
  };

  const handleTogglePlaylistMode = async (p: UserPlaylist) => {
    const next: PlaybackMode = p.mode === "audio" ? "video" : "audio";
    await vaultTubeApi.setUserPlaylistMode(p.id, next);
    refresh();
  };

  // Lecture « Tout lire » façon Spotify
  const handlePlayAllSub = async (sub: VaultTubeSubscription) => {
    const vids = await vaultTubeApi.listVideos(sub.id);
    if (vids.length === 0) return;
    playQueue(
      vids.map((v, i) => ({
        id: v.id || i + 1,
        title: v.title,
        path: watchUrl(v.source, v.youtube_id),
        libraryId: -1,
        mode: sub.mode,
      })),
      0
    );
  };

  const handlePlayAllPlaylist = async (p: UserPlaylist) => {
    const items = await vaultTubeApi.listUserPlaylistItems(p.id);
    if (items.length === 0) return;
    playQueue(
      items.map((it, i) => ({
        id: it.id || i + 1,
        title: it.title,
        path: watchUrl(it.source, it.youtube_id),
        libraryId: -1,
        mode: p.mode,
      })),
      0
    );
  };

  const handleSearchPlayVideo = (r: SearchResult) => {
    playQueue([{ id: 0, title: r.title, path: r.url, libraryId: -1, mode: "video" }], 0);
  };

  const handleSearchFollow = async (r: SearchResult) => {
    setBusyUrl(r.url);
    setError(null);
    try {
      await vaultTubeApi.addSubscription(r.url);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyUrl(null);
    }
  };

  const handleSearchPreviewPlaylist = (r: SearchResult) => {
    const m = r.url.match(/[?&]list=([^&]+)/);
    if (m) navigate(`/vaulttube/playlist/${m[1]}`);
  };

  /* ────────────────────────────────────────────────────────────────
     0.8.0 — MODE AUDIO : hub premium MusicHub.
     Retour anticipé : tout ce qui suit (ancien rendu) reste réservé
     aux modes "video" et mixte, strictement inchangés.
     ──────────────────────────────────────────────────────────────── */
  if (defaultMode === "audio") {
    const searchingNow = searching;
    const resultVideos =
      searchResults !== null ? searchResults.filter((r) => r.kind === "video") : null;

    // 0.8.0 — décrit une piste UNE seule fois (artiste déduit du titre,
    // pochette HD + repli) pour que LISTE, FILE, HUB et LECTEUR
    // partagent exactement les mêmes données.
    const describe = (item: SearchResult | VaultTubeVideo, isResult: boolean) => {
      const r = isResult ? (item as SearchResult) : null;
      const v = isResult ? null : (item as VaultTubeVideo);
      const source = isResult ? r!.source : v!.source;
      const ytId = source === "youtube" ? (isResult ? r!.id : v!.youtube_id) : null;
      const covers = youtubeCovers(
        source,
        ytId,
        isResult ? r!.thumbnail_url : v!.thumbnail_url
      );
      const artist = isResult
        ? (r!.channel ?? guessArtist(r!.title, "AetherFy"))
        : guessArtist(v!.title, v!.channel ?? "AetherFy");
      return { r, v, source, ytId, covers, artist };
    };

    const tracks: MusicTrack[] = (resultVideos ?? audioVideos).map((item) => {
      const isResult = resultVideos !== null;
      const d = describe(item, isResult);
      return {
        id: isResult ? `${d.r!.source}:${d.r!.id}` : String(d.v!.id ?? d.v!.youtube_id),
        title: isResult ? d.r!.title : d.v!.title,
        artist: d.artist,
        duration: formatDuration(isResult ? d.r!.duration_seconds : d.v!.duration_seconds),
        cover: d.covers.cover,
        coverFallback: d.covers.coverFallback,
        source: toMusicSource(d.source),
      };
    });

    // File de lecture : transporte pochette HD + artiste + id YouTube
    // → l'overlay immersif et la mini-barre affichent EXACTEMENT la
    // même image et le même nom que la liste MusicHub.
    // `PlayableMedia` attend `string | undefined` (pas `null`) pour
    // `youtubeId` → conversion explicite.
    const queueItems = (resultVideos ?? audioVideos).map((item, i) => {
      const isResult = resultVideos !== null;
      const d = describe(item, isResult);
      return {
        id: isResult ? i + 1 : d.v!.id || i + 1,
        title: isResult ? d.r!.title : d.v!.title,
        path: isResult ? d.r!.url : watchUrl(d.v!.source, d.v!.youtube_id),
        libraryId: -1,
        mode: "audio" as PlaybackMode,
        // `PlayableMedia` attend `string | undefined` (pas `null`)
        // pour `thumbnail` et `youtubeId` → conversions explicites.
        thumbnail: d.covers.cover ?? undefined,
        youtubeId: d.ytId ?? undefined,
        channel: d.artist,
      };
    });

    const playlists: MusicPlaylist[] = visibleUserPlaylists.map((p) => ({
      id: String(p.id),
      name: p.name,
      cover: null,
      count: p.item_count,
      local: true,
    }));

    const musicSubs: MusicSubscription[] = visibleSubscriptions.map((s) => ({
      id: String(s.id),
      name: s.name,
      cover: s.thumbnail_url,
      kind: s.kind === "playlist" ? "playlist" : "channel",
    }));

    // Piste en cours : reprise de la pochette/artiste de la liste si le
    // titre correspond, sinon déduction directe depuis currentMedia.
    const currentBase = currentMedia && currentMedia.mode === "audio" ? currentMedia : null;
    let currentTrack: MusicTrack | null = null;
    if (currentBase) {
      const match = tracks.find((t) => t.title === currentBase.title) ?? null;
      const ytId =
        currentBase.youtubeId ??
        (currentBase.path.match(/[?&]v=([^&]+)/)?.[1] ?? null);
      const covers = youtubeCovers(
        currentBase.path.includes("dailymotion") ? "dailymotion" : "youtube",
        ytId,
        currentBase.thumbnail ?? null
      );
      currentTrack = {
        id: match?.id ?? String(currentBase.id),
        title: currentBase.title,
        artist: match?.artist ?? currentBase.channel ?? guessArtist(currentBase.title, "AetherFy"),
        duration: formatDuration(duration > 0 ? duration : null),
        cover: match?.cover ?? covers.cover,
        coverFallback: match?.coverFallback ?? covers.coverFallback,
        source: match?.source ?? "youtube",
      };
    }

    const playFromIndex = (index: number) => {
      if (queueItems.length === 0) return;
      playQueue(queueItems, Math.max(0, Math.min(index, queueItems.length - 1)));
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div
            style={{
              padding: "9px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,.12)",
              color: "#fca5a5",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        <MusicHub
          tracks={tracks}
          playlists={playlists}
          subscriptions={musicSubs}
          current={currentTrack}
          playing={isPlaying}
          progress={duration > 0 ? { position, duration } : null}
          queue={tracks.filter((t) => t.id !== currentTrack?.id).slice(0, 5)}
          query={searchQuery}
          onQuery={setSearchQuery}
          source={searchSource as MusicSource}
          onSource={(s) => setSearchSource(s)}
          onPlayTrack={(id) => {
            const index = tracks.findIndex((t) => t.id === id);
            if (index >= 0) playFromIndex(index);
          }}
          onPlayAll={() => playFromIndex(0)}
          onShuffle={() => {
            if (queueItems.length === 0) return;
            const shuffled = [...queueItems].sort(() => Math.random() - 0.5);
            playQueue(shuffled, 0);
          }}
          onToggleLike={() => {
            /* Favoris AetherFy : non câblés backend pour l'instant. */
          }}
          onCreatePlaylist={(name) => {
            void vaultTubeApi.createUserPlaylist(name, "audio").then(() => refresh());
          }}
          onOpenPlaylist={(id) => navigate(`/vaulttube/myplaylist/${id}`)}
          onOpenSubscription={(id) => navigate(`/vaulttube/${id}`)}
          onFollowUrl={(url) => void handleFollowUrl(url)}
          onTogglePlay={togglePlay}
          onNext={playNext}
          onPrev={playPrevious}
        />
        {searchingNow && (
          <p style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>Recherche…</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* En-tête moderne (même langage que l'accueil). Le mot-symbole
          « AetherFy » garde la police Major Mono Display ; « Vidéo »
          reste dans la police de titres.
          0.8.0 : le mode audio retourne plus haut (MusicHub) — il n'y a
          donc plus AUCUNE comparaison « audio » ici (code mort qui
          déclenchait TS2367). */}
      <ModernPageHeader
        icon={defaultMode === "video" ? <Video size={26} /> : <Radio size={26} />}
        tint={defaultMode === "video" ? "255, 46, 99" : "124, 92, 255"}
        kicker={
          defaultMode === "video"
            ? "Vos chaînes et playlists vidéo"
            : "Streaming multi-sources"
        }
        title={
          <>
            <span className="avm-brand-aetherfy">AetherFy</span>
            {defaultMode === "video" ? " Vidéo" : ""}
          </>
        }
      />
      <div className="avm-hxp-search">
        {/* Recherche + sélecteur de source */}
        <div style={{ display: "flex", gap: 8, marginTop: 20, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              size={15}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-text-muted, #9a9aa3)",
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher des vidéos, chaînes, playlists…"
              style={{ ...inputStyle, paddingLeft: 34 }}
            />
          </div>
          {(["all", "youtube", "dailymotion"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSearchSource(s)}
              style={{
                padding: "7px 13px",
                borderRadius: 999,
                border: `1px solid ${searchSource === s ? "var(--color-accent, #7c5cff)" : "#2a2a32"}`,
                background: searchSource === s ? "rgba(124,92,255,.18)" : "transparent",
                color: searchSource === s ? "#c4b5ff" : "var(--color-text-muted, #9a9aa3)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {s === "all" ? "Toutes" : s === "youtube" ? "YouTube" : "Dailymotion"}
            </button>
          ))}
          {searching && (
            <span style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>…</span>
          )}
        </div>
      </div>
      {/* Résultats de recherche */}
      {searchResults !== null && (
        <div
          style={{
            background: "#16161c",
            border: "1px solid rgba(255,255,255,.06)",
            borderRadius: 10,
            padding: 12,
            marginTop: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-muted, #9a9aa3)",
              marginBottom: 10,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {searchResults.length} résultat(s) pour « {searchQuery} »
          </div>
          {searchResults.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)", margin: 0 }}>
              Aucun résultat.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {searchResults.map((r) => (
                <div
                  key={`${r.source}-${r.kind}-${r.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 8,
                    borderRadius: 8,
                    transition: "background .15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div
                    style={{
                      width: 64,
                      height: 48,
                      borderRadius: 6,
                      overflow: "hidden",
                      background: "#000",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {r.thumbnail_url ? (
                      <img
                        src={r.thumbnail_url}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : r.kind === "channel" ? (
                      <UserCircle2 size={28} style={{ color: "#555" }} />
                    ) : r.kind === "playlist" ? (
                      <ListVideo size={22} style={{ color: "#555" }} />
                    ) : (
                      <Play size={18} style={{ color: "#555" }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <SourceBadge source={r.source} />
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.title}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted, #9a9aa3)" }}>
                      {r.kind === "video" && r.channel && <>{r.channel}</>}
                      {r.kind === "video" && r.duration_seconds !== null && (
                        <>
                          {r.channel ? " · " : ""}
                          {formatDuration(r.duration_seconds)}
                        </>
                      )}
                      {r.kind === "playlist" && r.video_count !== null && `${r.video_count} vidéo(s)`}
                      {r.kind === "channel" && "Chaîne"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    {r.kind === "video" && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => handleSearchPlayVideo(r)}
                          style={{ padding: "5px 10px", fontSize: 12 }}
                        >
                          <Play size={12} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
                          Lire
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setPickerVideo({
                              youtube_id: r.id,
                              title: r.title,
                              thumbnail_url: r.thumbnail_url,
                              duration_seconds: r.duration_seconds,
                              channel: r.channel,
                              source: r.source,
                            })
                          }
                          style={{ padding: "5px 10px", fontSize: 12 }}
                        >
                          <ListVideo size={12} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
                          Playlist
                        </Button>
                      </>
                    )}
                    {r.kind === "playlist" && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => handleSearchPreviewPlaylist(r)}
                          style={{ padding: "5px 10px", fontSize: 12 }}
                        >
                          Voir
                        </Button>
                        <Button
                          onClick={() => void handleSearchFollow(r)}
                          disabled={busyUrl === r.url}
                          style={{ padding: "5px 10px", fontSize: 12 }}
                        >
                          <Plus size={12} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
                          Suivre
                        </Button>
                      </>
                    )}
                    {r.kind === "channel" && (
                      <Button
                        onClick={() => void handleSearchFollow(r)}
                        disabled={busyUrl === r.url}
                        style={{ padding: "5px 10px", fontSize: 12 }}
                      >
                        <Plus size={12} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
                        {busyUrl === r.url ? "Ajout…" : "Suivre"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Mes playlists (locales) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <div style={sectionTitle}>Mes playlists</div>
        <input
          value={newPlaylist}
          onChange={(e) => setNewPlaylist(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleCreatePlaylist()}
          placeholder="Nouvelle playlist…"
          style={{ ...inputStyle, maxWidth: 220 }}
        />
        <button
          onClick={() => setNewPlaylistMode(newPlaylistMode === "audio" ? "video" : "audio")}
          title="Mode de la nouvelle playlist"
          style={{
            padding: "7px 12px",
            borderRadius: 999,
            border: "1px solid #2a2a32",
            background: newPlaylistMode === "audio" ? "rgba(29,185,84,.15)" : "transparent",
            color: newPlaylistMode === "audio" ? "#1db954" : "var(--color-text-muted, #9a9aa3)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {newPlaylistMode === "audio" ? "🎵 Musique" : "🎬 Vidéo"}
        </button>
        <Button
          variant="secondary"
          onClick={() => void handleCreatePlaylist()}
          disabled={!newPlaylist.trim()}
        >
          Créer
        </Button>
      </div>
      <div style={gridStyle}>
        {visibleUserPlaylists.map((p) => (
          <AetherCard
            key={p.id}
            title={p.name}
            subtitle={`${p.item_count} vidéo(s) · locale`}
            image={null}
            mode={p.mode}
            onOpen={() => navigate(`/vaulttube/myplaylist/${p.id}`)}
            onPlayAll={() => void handlePlayAllPlaylist(p)}
            onToggleMode={() => void handleTogglePlaylistMode(p)}
            onRemove={() => void handleDeletePlaylistFromGrid(p.id, p.name)}
          />
        ))}
        {visibleUserPlaylists.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            {defaultMode
              ? "Aucune playlist locale dans ce mode — créez-en une ci-dessus."
              : "Aucune playlist locale — créez-en une ci-dessus."}
          </p>
        )}
      </div>
      {/* Abonnements (chaînes + playlists suivies, toutes sources) */}
      <div style={sectionTitle}>Abonnements</div>
      <div style={gridStyle}>
        {visibleSubscriptions.map((sub) => (
          <AetherCard
            key={sub.id}
            title={sub.name}
            subtitle={sub.kind === "playlist" ? "Playlist suivie" : "Chaîne suivie"}
            image={sub.thumbnail_url}
            source={sub.source}
            mode={sub.mode}
            onOpen={() => navigate(`/vaulttube/${sub.id}`)}
            onPlayAll={() => void handlePlayAllSub(sub)}
            onToggleMode={() => void handleToggleSubMode(sub)}
            onRemove={() => void handleRemove(sub.id)}
          />
        ))}
        {visibleSubscriptions.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            {defaultMode
              ? "Aucun abonnement dans ce mode — suivez une chaîne via la recherche ou l'URL ci-dessous."
              : "Aucun abonnement — suivez une chaîne via la recherche ou l'URL ci-dessous."}
          </p>
        )}
      </div>
      {/* Ajout par URL */}
      <div style={{ display: "flex", gap: 8, marginTop: 26 }}>
        <input
          type="text"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
          placeholder="ou collez l'URL d'une chaîne / playlist (YouTube, Dailymotion, Vimeo…)"
          style={inputStyle}
          disabled={adding}
        />
        <Button onClick={() => void handleAdd()} disabled={adding || !newUrl.trim()}>
          <Plus size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          {adding ? "Ajout…" : "Suivre"}
        </Button>
      </div>
      {error && (
        <div
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            background: "rgba(239,68,68,.12)",
            color: "#fca5a5",
            marginTop: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      {pickerVideo && (
        <VaultTubePlaylistPicker video={pickerVideo} onClose={() => setPickerVideo(null)} />
      )}
    </div>
  );
}