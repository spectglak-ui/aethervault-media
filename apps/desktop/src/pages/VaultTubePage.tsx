import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  RefreshCw,
  Trash2,
  Youtube,
  Search,
  Play,
  ListVideo,
  UserCircle2,
} from "lucide-react";
import { Button, PageHeader } from "@aethervault/ui-kit";
import {
  vaultTubeApi,
  type SearchResult,
  type VaultTubeSubscription,
  type UserPlaylist,
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

const iconBtn: CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--color-text-muted, #9a9aa3)",
  padding: 6,
  borderRadius: 6,
  display: "inline-flex",
};

const badgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "2px 7px",
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted, #9a9aa3)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  margin: "6px 0 10px",
};

function kindBadge(kind: string) {
  if (kind === "playlist")
    return (
      <span style={{ ...badgeStyle, background: "#3a2a6d", color: "#c4b5ff" }}>Playlist</span>
    );
  if (kind === "channel")
    return <span style={{ ...badgeStyle, background: "#6d3a2a", color: "#ffc4b5" }}>Chaîne</span>;
  return <span style={{ ...badgeStyle, background: "#2a4d6d", color: "#b5d9ff" }}>Vidéo</span>;
}

/** Carte d'abonnement (chaîne ou playlist suivie) */
function SubscriptionCard({
  sub,
  busy,
  onOpen,
  onRefresh,
  onRemove,
}: {
  sub: VaultTubeSubscription;
  busy: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        background: "var(--color-surface, #1e1e24)",
        border: "1px solid rgba(255,255,255,.06)",
        borderRadius: 12,
        cursor: "pointer",
        transition: "border-color .15s ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--color-accent, #7c5cff)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,.06)")}
    >
      {sub.thumbnail_url ? (
        <img
          src={sub.thumbnail_url}
          alt=""
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "linear-gradient(135deg, var(--color-accent, #7c5cff), #4c3a99)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 20,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {sub.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)", marginTop: 2 }}>
          {sub.kind === "playlist" ? "Playlist" : "Chaîne"}
          {sub.last_synced_at !== null &&
            ` · synchronisé le ${new Date(sub.last_synced_at * 1000).toLocaleDateString()}`}
        </div>
      </div>
      <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
        <button title="Actualiser" style={iconBtn} disabled={busy} onClick={onRefresh}>
          <RefreshCw size={16} />
        </button>
        <button title="Supprimer" style={iconBtn} onClick={onRemove}>
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

export function VaultTubePage() {
  const navigate = useNavigate();
  const { playQueue } = usePlayer();

  // Abonnements
  const [subscriptions, setSubscriptions] = useState<VaultTubeSubscription[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Playlists locales
  const [userPlaylists, setUserPlaylists] = useState<UserPlaylist[]>([]);
  const [newPlaylist, setNewPlaylist] = useState("");

  // Recherche
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Picker de playlist (ajout de vidéo à une playlist locale)
  const [pickerVideo, setPickerVideo] = useState<PickableVideo | null>(null);

  const refresh = useCallback(() => {
    vaultTubeApi.listSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
    vaultTubeApi.listUserPlaylists().then(setUserPlaylists).catch(() => setUserPlaylists([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  const handleCreatePlaylist = async () => {
    const name = newPlaylist.trim();
    if (!name) return;
    await vaultTubeApi.createUserPlaylist(name);
    setNewPlaylist("");
    refresh();
  };

  // Recherche debounced (500 ms)
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
        .search(q)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 500);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  // Actions sur les résultats de recherche
  const handleSearchPlayVideo = (r: SearchResult) => {
    playQueue([{ id: 0, title: r.title, path: r.url, libraryId: -1 }], 0);
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
    if (m) {
      navigate(`/vaulttube/playlist/${m[1]}`);
    }
  };

  return (
    <div>
      <PageHeader title="VaultTube" />
      <p style={{ color: "var(--color-text-muted, #9a9aa3)", margin: "-8px 0 18px", fontSize: 13 }}>
        Chaînes, playlists et vidéos YouTube — lecture sans publicité via le lecteur intégré.
      </p>

      {/* Barre de recherche YouTube */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
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
            placeholder="Rechercher sur YouTube (vidéos, chaînes, playlists)…"
            style={{ ...inputStyle, paddingLeft: 34 }}
          />
        </div>
        {searching && (
          <span style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>Recherche…</span>
        )}
      </div>

      {/* Résultats de recherche */}
      {searchResults !== null && (
        <div
          style={{
            background: "#16161c",
            border: "1px solid rgba(255,255,255,.06)",
            borderRadius: 10,
            padding: 12,
            marginBottom: 20,
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
                  key={`${r.kind}-${r.id}`}
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
                  {/* Thumbnail */}
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

                  {/* Titre + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      {kindBadge(r.kind)}
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
                      {r.kind === "channel" && "Chaîne YouTube"}
                    </div>
                  </div>

                  {/* Actions contextuelles */}
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
                          onClick={() => handleSearchFollow(r)}
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
                        onClick={() => handleSearchFollow(r)}
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

      {/* Barre d'ajout par URL */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <input
          type="text"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
          placeholder="ou collez directement l'URL d'une chaîne / playlist YouTube…"
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
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* --- Mes playlists (locales) --- */}
      <div style={sectionTitleStyle}>Mes playlists</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          value={newPlaylist}
          onChange={(e) => setNewPlaylist(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleCreatePlaylist()}
          placeholder="Nouvelle playlist locale…"
          style={{ ...inputStyle, maxWidth: 260 }}
        />
        <Button
          variant="secondary"
          onClick={() => void handleCreatePlaylist()}
          disabled={!newPlaylist.trim()}
        >
          Créer
        </Button>
      </div>
      {userPlaylists.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {userPlaylists.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/vaulttube/myplaylist/${p.id}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                background: "var(--color-surface, #1e1e24)",
                border: "1px solid rgba(255,255,255,.06)",
                borderRadius: 10,
                cursor: "pointer",
                transition: "border-color .15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--color-accent, #7c5cff)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,.06)")}
            >
              <ListVideo size={20} style={{ color: "var(--color-accent, #7c5cff)" }} />
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{p.name}</span>
              <span style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>
                {p.item_count} vidéo(s)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* --- Chaînes suivies --- */}
      <div style={sectionTitleStyle}>Chaînes suivies</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {subscriptions
          .filter((s) => s.kind !== "playlist")
          .map((sub) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              busy={busyId === sub.id}
              onOpen={() => navigate(`/vaulttube/${sub.id}`)}
              onRefresh={() => void handleRefresh(sub.id)}
              onRemove={() => void handleRemove(sub.id)}
            />
          ))}
        {subscriptions.filter((s) => s.kind !== "playlist").length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            Aucune chaîne suivie pour l'instant.
          </p>
        )}
      </div>

      {/* --- Playlists suivies --- */}
      <div style={sectionTitleStyle}>Playlists suivies</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {subscriptions
          .filter((s) => s.kind === "playlist")
          .map((sub) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              busy={busyId === sub.id}
              onOpen={() => navigate(`/vaulttube/${sub.id}`)}
              onRefresh={() => void handleRefresh(sub.id)}
              onRemove={() => void handleRemove(sub.id)}
            />
          ))}
        {subscriptions.filter((s) => s.kind === "playlist").length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            Aucune playlist suivie pour l'instant.
          </p>
        )}
      </div>

      {/* État vide global */}
      {subscriptions.length === 0 &&
        userPlaylists.length === 0 &&
        !adding &&
        searchResults === null && (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              color: "var(--color-text-muted, #9a9aa3)",
              marginTop: 20,
            }}
          >
            <Youtube size={44} style={{ opacity: 0.45, marginBottom: 12 }} />
            <p>Aucun abonnement pour l'instant.</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              Recherchez ci-dessus ou collez une URL YouTube pour commencer.
            </p>
          </div>
        )}

      {/* Picker de playlist (modale) */}
      {pickerVideo && (
        <VaultTubePlaylistPicker video={pickerVideo} onClose={() => setPickerVideo(null)} />
      )}
    </div>
  );
}