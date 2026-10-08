import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Flame, Users, Library as LibraryIcon, History as HistoryIcon, Clock, Heart,
  Music, Gamepad2, Radio, Plus, Trash2, RefreshCw, X, ListVideo, Link2,
} from "lucide-react";
import type { VaultTubeVideo, VaultTubeSubscription, SearchResult } from "../vaulttube/api";
import { vaultTubeApi } from "../vaulttube/api";
import { AetherFyVideoCard } from "./AetherFyVideoCard";
import {
  listHistory, clearHistory, removeFromHistory,
  listWatchLater, toggleWatchLater,
  listLiked, toggleLiked,
  type AfySavedVideo,
} from "./afyLibrary";

type CardVideo = VaultTubeVideo & { channelAvatar?: string | null };

function fromSearch(r: SearchResult): CardVideo {
  return {
    id: 0, subscription_id: 0, youtube_id: r.id, title: r.title,
    description: null, thumbnail_url: r.thumbnail_url,
    duration_seconds: r.duration_seconds, published_at: null, added_at: 0,
    source: r.source, mode: "video", is_short: false, channel: r.channel,
  };
}
function fromSaved(s: AfySavedVideo): CardVideo {
  return {
    id: 0, subscription_id: 0, youtube_id: s.youtube_id, title: s.title,
    description: null, thumbnail_url: s.thumbnail_url,
    duration_seconds: s.duration_seconds, published_at: null, added_at: s.added_at,
    source: s.source, mode: "video", is_short: false, channel: s.channel,
  };
}

/* ---------- infra commune ---------- */

function useFeed(loader: () => Promise<CardVideo[]>) {
  const [items, setItems] = useState<CardVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((v) => setItems(v))
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { items, loading, error, reload };
}

function AfyGridPage(props: {
  title: string;
  icon: React.ReactNode;
  items: CardVideo[];
  loading: boolean;
  error: string | null;
  empty?: string;
  live?: boolean;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="afy-page-head">
        <h1>{props.icon}{props.title}</h1>
        <div className="afy-page-head__actions">{props.actions}</div>
      </div>
      {props.children}
      {props.loading && <div className="afy-loader">Chargement…</div>}
      {!props.loading && props.error && (
        <div className="afy-empty"><div className="afy-empty__title">{props.error}</div></div>
      )}
      {!props.loading && !props.error && props.items.length === 0 && (
        <div className="afy-empty"><div className="afy-empty__title">{props.empty ?? "Rien pour l'instant."}</div></div>
      )}
      {!props.loading && props.items.length > 0 && (
        <div className="afy-grid" style={{ margin: "16px 24px" }}>
          {props.items.map((v) => (
            <AetherFyVideoCard key={`${v.source}-${v.youtube_id}`} video={v} live={props.live} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 0.8.1 Tendances : VOS vidéos les plus visionnées, classées ---------- */

export function AetherFyTrendingPage() {
  const [tick, setTick] = useState(0);
  const top = useMemo(() => {
    return [...listHistory()]
      .sort((a, b) => (b.plays ?? 1) - (a.plays ?? 1) || b.added_at - a.added_at)
      .slice(0, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return (
    <AfyGridPage
      title="Tendances"
      icon={<Flame size={20} style={{ color: "#ff9f1c" }} />}
      items={[]}
      loading={false}
      error={null}
      empty="Aucune statistique pour l'instant : regardez des vidéos, vos incontournables apparaîtront classés ici."
    >
      {top.length > 0 && (
        <div className="afy-grid" style={{ margin: "16px 24px" }}>
          {top.map((s, i) => (
            <div key={s.youtube_id} className="afy-removable">
              <span className="afy-rank-badge">{i + 1}</span>
              <AetherFyVideoCard video={fromSaved(s)} />
              <div className="afy-rank-plays">
                {s.plays ?? 1} visionnage(s) • dernière fois il y a{" "}
                {Math.max(0, Math.round((Date.now() / 1000 - s.added_at) / 86400))} j
              </div>
            </div>
          ))}
        </div>
      )}
    </AfyGridPage>
  );
}

/* ---------- 0.8.1 Directs : uniquement les lives de VOS abonnements ---------- */

export function AetherFyLivePage() {
  const feed = useFeed(async () => {
    const subs = await vaultTubeApi.listSubscriptions();
    const channels = subs.filter((s) => s.kind === "channel").slice(0, 10);
    const chunks = await Promise.all(
      channels.map(async (sub) => {
        try {
          // Onglet « Streams » de la chaîne : les directs en cours / à
          // venir y ont une durée nulle (les rediffs de lives ont une durée).
          const vids = await vaultTubeApi.previewVideos(
            `${sub.url.replace(/\/$/, "")}/streams`
          );
          return vids
            .filter((v) => v.duration_seconds == null || v.duration_seconds <= 0)
            .map(
              (v): CardVideo => ({
                ...v,
                channel: v.channel ?? sub.name,
                channelAvatar: sub.thumbnail_url ?? null,
              })
            );
        } catch {
          return [] as CardVideo[];
        }
      })
    );
    return chunks.flat();
  });
  return (
    <AfyGridPage
      title="Directs"
      icon={<Radio size={20} style={{ color: "#ff2e63" }} />}
      {...feed}
      live
      empty="Aucun direct en cours ou programmé sur vos abonnements."
    />
  );
}

/* ---------- Jeux oniriques (inchangé : recherche globale gameplay) ---------- */

export function AetherFyGamingPage() {
  const feed = useFeed(async () => {
    const r = await vaultTubeApi.search("jeux indépendants gameplay fr");
    return r.filter((x) => x.kind === "video").map(fromSearch);
  });
  return (
    <AfyGridPage
      title="Jeux oniriques"
      icon={<Gamepad2 size={20} style={{ color: "#2ec4b6" }} />}
      {...feed}
      empty="Aucune vidéo gaming trouvée."
    />
  );
}

/* ---------- Musique ---------- */

export function AetherFyMusicPage() {
  const feed = useFeed(async () => {
    const subs = await vaultTubeApi.listSubscriptions();
    const audioSubs = subs.filter((s) => s.mode === "audio");
    if (audioSubs.length > 0) {
      const chunks = await Promise.all(
        audioSubs.map(async (s) => {
          try {
            return await vaultTubeApi.listVideos(s.id);
          } catch {
            return [] as VaultTubeVideo[];
          }
        })
      );
      const flat = chunks.flat();
      if (flat.length > 0) return flat;
    }
    const r = await vaultTubeApi.search("mix musique fr");
    return r.filter((x) => x.kind === "video").map(fromSearch);
  });
  return (
    <AfyGridPage
      title="Musique"
      icon={<Music size={20} style={{ color: "#ff9f1c" }} />}
      {...feed}
      empty="Aucune piste : abonnez-vous à une chaîne en mode audio."
    />
  );
}

/* ---------- Abonnements ---------- */

export function AetherFySubscriptionsPage() {
  const navigate = useNavigate();
  const [subs, setSubs] = useState<VaultTubeSubscription[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await vaultTubeApi.listSubscriptions();
      setSubs(list);
      const cs: Record<number, number> = {};
      await Promise.all(
        list.map(async (s) => {
          try {
            cs[s.id] = (await vaultTubeApi.listVideos(s.id)).length;
          } catch {
            cs[s.id] = 0;
          }
        })
      );
      setCounts(cs);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const sync = async (id: number) => {
    setSyncingId(id);
    try {
      await vaultTubeApi.refreshSubscription(id);
      await load();
    } finally {
      setSyncingId(null);
    }
  };
  const remove = async (id: number, name: string) => {
    if (!window.confirm(`Se désabonner de « ${name} » ? Les vidéos locales resteront en base.`)) return;
    await vaultTubeApi.removeSubscription(id);
    await load();
  };

  return (
    <AfyGridPage title="Abonnements" icon={<Users size={20} />} items={[]} loading={loading} error={null}>
      <div className="afy-lib-grid">
        {subs.map((s) => (
          <div key={s.id} className="afy-sub-card">
            <div className="afy-sub-card__head">
              {s.thumbnail_url ? (
                <img className="afy-sub-card__avatar" src={s.thumbnail_url} alt="" />
              ) : (
                <div className="afy-sub-card__avatar afy-sub-head__avatar--fallback" style={{ width: 56, height: 56, fontSize: 20 }}>
                  {s.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div className="afy-sub-card__name">{s.name}</div>
                <div className="afy-sub-card__meta">
                  {counts[s.id] ?? 0} vidéo(s) • {s.mode === "audio" ? "Musique" : "Vidéo"} • {s.source}
                </div>
              </div>
            </div>
            <div className="afy-sub-card__actions">
              <button type="button" className="afy-btn-secondary" onClick={() => navigate(`/aetherfy/subscription/${s.id}`)}>
                Ouvrir
              </button>
              <button type="button" className="afy-btn-secondary" onClick={() => void sync(s.id)} disabled={syncingId === s.id}>
                <RefreshCw size={14} className={syncingId === s.id ? "afy-spin" : undefined} /> Sync
              </button>
              <button type="button" className="afy-btn-secondary" onClick={() => void remove(s.id, s.name)} title="Se désabonner">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </AfyGridPage>
  );
}

/* ---------- 0.8.1 Bibliothèque : menu « Nouvelle playlist » à 2 choix ---------- */

export function AetherFyLibraryPage() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<{ id: number; name: string; item_count: number; mode: string }[]>([]);
  const [tick, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const later = listWatchLater().length;
  const liked = listLiked().length;
  const history = listHistory().length;

  useEffect(() => {
    vaultTubeApi.listUserPlaylists().then((p) => setPlaylists(p)).catch(() => {});
  }, [tick]);

  const createEmpty = async () => {
    setMenuOpen(false);
    const name = window.prompt("Nom de la nouvelle playlist :");
    if (!name?.trim()) return;
    await vaultTubeApi.createUserPlaylist(name.trim(), "video");
    setTick((t) => t + 1);
  };

  const createFromUrl = async () => {
    setMenuOpen(false);
    const url = window.prompt("Lien de la playlist à importer (YouTube, Dailymotion…) :");
    if (!url?.trim()) return;
    setImporting(true);
    try {
      const vids = await vaultTubeApi.previewVideos(url.trim());
      if (vids.length === 0) {
        window.alert("Aucune vidéo trouvée à ce lien.");
        return;
      }
      const name = window.prompt(`Nom de la playlist (${vids.length} vidéo(s) trouvée(s)) :`, "Playlist importée");
      if (name === null) return;
      const id = await vaultTubeApi.createUserPlaylist(name.trim() || "Playlist importée", "video");
      for (const v of vids.slice(0, 100)) {
        await vaultTubeApi.addToUserPlaylist({
          playlistId: id,
          youtubeId: v.youtube_id,
          title: v.title,
          thumbnailUrl: v.thumbnail_url,
          durationSeconds: v.duration_seconds,
          channel: v.channel ?? null,
          source: v.source,
        });
      }
      setTick((t) => t + 1);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <AfyGridPage
      title="Bibliothèque"
      icon={<LibraryIcon size={20} />}
      items={[]}
      loading={false}
      error={null}
      actions={
        <div style={{ position: "relative" }}>
          <button type="button" className="afy-btn-primary" onClick={() => setMenuOpen((o) => !o)}>
            <Plus size={14} /> Nouvelle playlist
          </button>
          {menuOpen && (
            <div className="afy-menu">
              <button type="button" className="afy-menu__item" onClick={() => void createEmpty()}>
                <ListVideo size={14} /> Playlist personnalisée
              </button>
              <button type="button" className="afy-menu__item" onClick={() => void createFromUrl()} disabled={importing}>
                <Link2 size={14} /> {importing ? "Import en cours…" : "Depuis un lien"}
              </button>
            </div>
          )}
        </div>
      }
    >
      <div className="afy-lib-grid">
        <button type="button" className="afy-sub-card" onClick={() => navigate("/aetherfy/watch-later")}>
          <div className="afy-sub-card__head">
            <Clock size={22} style={{ color: "#ff9f1c" }} />
            <div>
              <div className="afy-sub-card__name">À regarder plus tard</div>
              <div className="afy-sub-card__meta">{later} vidéo(s)</div>
            </div>
          </div>
        </button>
        <button type="button" className="afy-sub-card" onClick={() => navigate("/aetherfy/liked")}>
          <div className="afy-sub-card__head">
            <Heart size={22} style={{ color: "#ff2e63" }} />
            <div>
              <div className="afy-sub-card__name">Vidéos aimées</div>
              <div className="afy-sub-card__meta">{liked} vidéo(s)</div>
            </div>
          </div>
        </button>
        <button type="button" className="afy-sub-card" onClick={() => navigate("/aetherfy/history")}>
          <div className="afy-sub-card__head">
            <HistoryIcon size={22} style={{ color: "#2ec4b6" }} />
            <div>
              <div className="afy-sub-card__name">Historique</div>
              <div className="afy-sub-card__meta">{history} entrée(s)</div>
            </div>
          </div>
        </button>
        {playlists.map((p) => (
          <div key={p.id} className="afy-sub-card">
            <div className="afy-sub-card__head">
              <ListVideo size={22} style={{ color: "#93a8af" }} />
              <div>
                <div className="afy-sub-card__name">{p.name}</div>
                <div className="afy-sub-card__meta">
                  {p.item_count} vidéo(s) • {p.mode === "audio" ? "Musique" : "Vidéo"}
                </div>
              </div>
            </div>
            <div className="afy-sub-card__actions">
              <button type="button" className="afy-btn-secondary" onClick={() => navigate(`/aetherfy/playlist/${p.id}`)}>
                Ouvrir
              </button>
              <button
                type="button"
                className="afy-btn-secondary"
                onClick={async () => {
                  if (!window.confirm(`Supprimer la playlist « ${p.name} » ?`)) return;
                  await vaultTubeApi.deleteUserPlaylist(p.id);
                  setTick((t) => t + 1);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </AfyGridPage>
  );
}

export function AetherFyUserPlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);
  const [title, setTitle] = useState("Playlist locale");
  const feed = useFeed(async () => {
    const [playlists, items] = await Promise.all([
      vaultTubeApi.listUserPlaylists(),
      vaultTubeApi.listUserPlaylistItems(pid),
    ]);
    const p = playlists.find((x) => x.id === pid);
    if (p) setTitle(p.name);
    return items.map(
      (it): CardVideo => ({
        id: it.id, subscription_id: 0, youtube_id: it.youtube_id, title: it.title,
        description: null, thumbnail_url: it.thumbnail_url,
        duration_seconds: it.duration_seconds, published_at: null, added_at: it.added_at,
        source: it.source, mode: it.mode, is_short: false, channel: it.channel,
      })
    );
  });
  return (
    <AfyGridPage title={title} icon={<ListVideo size={20} />} items={[]} loading={feed.loading} error={feed.error} empty="Playlist vide.">
      {feed.items.length > 0 && (
        <div className="afy-grid" style={{ margin: "16px 24px" }}>
          {feed.items.map((v) => (
            <AetherFyVideoCard
              key={`${v.source}-${v.youtube_id}`}
              video={v}
              navState={{ playlistId: pid, playlistTitle: title }}
            />
          ))}
        </div>
      )}
    </AfyGridPage>
  );
}

/* ---------- Historique / Plus tard / Aimées ---------- */

function AfySavedPage(props: {
  title: string;
  icon: React.ReactNode;
  list: AfySavedVideo[];
  onRemove: (id: string) => void;
  onClear?: () => void;
  empty: string;
}) {
  return (
    <div>
      <div className="afy-page-head">
        <h1>{props.icon}{props.title}</h1>
        <div className="afy-page-head__actions">
          {props.onClear && (
            <button type="button" className="afy-btn-secondary" onClick={props.onClear}>
              <Trash2 size={14} /> Tout vider
            </button>
          )}
        </div>
      </div>
      {props.list.length === 0 ? (
        <div className="afy-empty"><div className="afy-empty__title">{props.empty}</div></div>
      ) : (
        <div className="afy-grid" style={{ margin: "16px 24px" }}>
          {props.list.map((s) => (
            <div key={s.youtube_id} className="afy-removable">
              <AetherFyVideoCard video={fromSaved(s)} />
              <button type="button" className="afy-remove-btn" title="Retirer" onClick={() => props.onRemove(s.youtube_id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AetherFyHistoryPage() {
  const [tick, setTick] = useState(0);
  const list = useMemo(() => listHistory(), [tick]);
  return (
    <AfySavedPage
      title="Historique"
      icon={<HistoryIcon size={20} style={{ color: "#2ec4b6" }} />}
      list={list}
      empty="Aucun visionnage enregistré pour l'instant."
      onRemove={(id) => { removeFromHistory(id); setTick((t) => t + 1); }}
      onClear={() => { clearHistory(); setTick((t) => t + 1); }}
    />
  );
}

export function AetherFyWatchLaterPage() {
  const [tick, setTick] = useState(0);
  const list = useMemo(() => listWatchLater(), [tick]);
  return (
    <AfySavedPage
      title="À regarder plus tard"
      icon={<Clock size={20} style={{ color: "#ff9f1c" }} />}
      list={list}
      empty="Rien en attente : ajoutez des vidéos depuis la page de lecture (bouton Enregistrer)."
      onRemove={(id) => { const v = list.find((x) => x.youtube_id === id); if (v) toggleWatchLater(v); setTick((t) => t + 1); }}
    />
  );
}

export function AetherFyLikedPage() {
  const [tick, setTick] = useState(0);
  const list = useMemo(() => listLiked(), [tick]);
  return (
    <AfySavedPage
      title="Vidéos aimées"
      icon={<Heart size={20} style={{ color: "#ff2e63" }} />}
      list={list}
      empty="Aucun coup de cœur pour l'instant."
      onRemove={(id) => { const v = list.find((x) => x.youtube_id === id); if (v) toggleLiked(v); setTick((t) => t + 1); }}
    />
  );
}