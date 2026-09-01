import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  ListVideo,
  Music,
  Play,
  Plus,
  Radio,
  Search,
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
} from "../features/vaulttube/api";
import { usePlayer } from "../player/PlayerContext";
import { formatDuration } from "./VaultTubeVideoGrid";
import { VaultTubePlaylistPicker, type PickableVideo } from "../components/VaultTubePlaylistPicker";
import "./pages.css";

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
 * bouton play rond et bascule de mode au survol. */
function AetherCard({
  title,
  subtitle,
  image,
  source,
  mode,
  onOpen,
  onPlayAll,
  onToggleMode,
}: {
  title: string;
  subtitle: string;
  image: string | null;
  source?: string;
  mode?: string;
  onOpen: () => void;
  onPlayAll?: () => void;
  onToggleMode?: () => void;
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

/** 0.4.0 — AetherFy : hub multi-sources façon Spotify (YouTube,
 * Dailymotion, Vimeo, PeerTube) — abonnements, playlists locales avec
 * mode musique/vidéo, recherche unifiée, lecture en un clic. */
export function VaultTubePage() {
  const navigate = useNavigate();
  const { playQueue } = usePlayer();

  const [subscriptions, setSubscriptions] = useState<VaultTubeSubscription[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<UserPlaylist[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [newPlaylist, setNewPlaylist] = useState("");
  const [newPlaylistMode, setNewPlaylistMode] = useState<PlaybackMode>("video");
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

  const refresh = useCallback(() => {
    vaultTubeApi.listSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
    vaultTubeApi.listUserPlaylists().then(setUserPlaylists).catch(() => setUserPlaylists([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  return (
    <div>
      {/* Header dégradé façon Spotify */}
      <div
        style={{
          margin: "-20px -20px 0",
          padding: "30px 26px 26px",
          background: "linear-gradient(180deg, rgba(124,92,255,.30), rgba(124,92,255,0) 95%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 12,
              background: "linear-gradient(135deg, #7c5cff, #4c3a99)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 6px 18px rgba(0,0,0,.45)",
            }}
          >
            <Radio size={26} color="#fff" />
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                color: "var(--color-text-muted, #9a9aa3)",
              }}
            >
              Streaming multi-sources
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, margin: 0 }}>AetherFy</div>
          </div>
        </div>

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
        {userPlaylists.map((p) => (
          <AetherCard
            key={p.id}
            title={p.name}
            subtitle={`${p.item_count} vidéo(s) · locale`}
            image={null}
            mode={p.mode}
            onOpen={() => navigate(`/vaulttube/myplaylist/${p.id}`)}
            onPlayAll={() => void handlePlayAllPlaylist(p)}
            onToggleMode={() => void handleTogglePlaylistMode(p)}
          />
        ))}
        {userPlaylists.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            Aucune playlist locale — créez-en une ci-dessus.
          </p>
        )}
      </div>

      {/* Abonnements (chaînes + playlists suivies, toutes sources) */}
      <div style={sectionTitle}>Abonnements</div>
      <div style={gridStyle}>
        {subscriptions.map((sub) => (
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
          />
        ))}
        {subscriptions.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            Aucun abonnement — suivez une chaîne via la recherche ou l'URL ci-dessous.
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