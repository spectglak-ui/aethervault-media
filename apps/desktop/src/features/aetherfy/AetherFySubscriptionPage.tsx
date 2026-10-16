import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, ListVideo, RefreshCw, Users } from "lucide-react";
import type {
  VaultTubePlaylist,
  VaultTubeSubscription,
  VaultTubeVideo,
} from "../vaulttube/api";
import { vaultTubeApi } from "../vaulttube/api";
import { AetherFyVideoCard } from "./AetherFyVideoCard";

/**
 * Page chaîne / abonnement, rangée en trois parties comme une chaîne YouTube :
 *  - « Vidéos »    : format horizontal (hors Shorts), triables ;
 *  - « Shorts »    : format vertical ;
 *  - « Playlists » : playlists publiques de la chaîne (chargées à la demande).
 *
 * Les Shorts suivent la même règle que l'accueil : le drapeau `is_short`
 * calculé par le backend (et non plus une heuristique de durée côté page).
 * Un seul onglet est rendu à la fois, par tranches (« Afficher plus ») : une
 * chaîne peut compter des milliers de vidéos.
 */

type Tab = "videos" | "shorts" | "playlists";
type SortKey = "recent" | "oldest" | "popular";

const VIDEOS_PAGE = 36;
const SHORTS_PAGE = 48;

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Plus récentes",
  oldest: "Plus anciennes",
  popular: "Plus populaires",
};

/** Date de référence d'une vidéo (secondes) : publication, sinon ajout. */
function dateOf(v: VaultTubeVideo): number {
  return v.published_at ?? v.added_at ?? 0;
}

function sortVideos(list: VaultTubeVideo[], key: SortKey): VaultTubeVideo[] {
  const copy = [...list];
  switch (key) {
    case "oldest":
      return copy.sort((a, b) => dateOf(a) - dateOf(b));
    case "popular":
      return copy.sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || dateOf(b) - dateOf(a));
    default:
      return copy.sort((a, b) => dateOf(b) - dateOf(a));
  }
}

export function AetherFySubscriptionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const subId = Number(id);

  const [subscription, setSubscription] = useState<VaultTubeSubscription | null>(null);
  const [videos, setVideos] = useState<VaultTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("videos");
  const [sort, setSort] = useState<SortKey>("recent");
  const [videosShown, setVideosShown] = useState(VIDEOS_PAGE);
  const [shortsShown, setShortsShown] = useState(SHORTS_PAGE);

  // `null` = pas encore demandé (chargé à la première ouverture de l'onglet).
  const [playlists, setPlaylists] = useState<VaultTubePlaylist[] | null>(null);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subs, vids] = await Promise.all([
        vaultTubeApi.listSubscriptions(),
        vaultTubeApi.listVideos(subId),
      ]);
      setSubscription(subs.find((s) => s.id === subId) ?? null);
      setVideos(vids);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [subId]);

  // Nouvelle chaîne : on repart d'un état neuf.
  useEffect(() => {
    setTab("videos");
    setSort("recent");
    setVideosShown(VIDEOS_PAGE);
    setShortsShown(SHORTS_PAGE);
    setPlaylists(null);
    setPlaylistsError(null);
    void load();
  }, [load]);

  const loadPlaylists = useCallback(
    async (forceSync: boolean) => {
      setPlaylistsLoading(true);
      setPlaylistsError(null);
      try {
        let list = await vaultTubeApi.listPlaylists(subId);
        if (list.length === 0 || forceSync) {
          // Aucune playlist en base (ou actualisation demandée) : on interroge la chaîne.
          await vaultTubeApi.syncPlaylists(subId).catch(() => 0);
          list = await vaultTubeApi.listPlaylists(subId);
        }
        setPlaylists(list);
      } catch (err) {
        setPlaylistsError(err instanceof Error ? err.message : String(err));
        setPlaylists([]);
      } finally {
        setPlaylistsLoading(false);
      }
    },
    [subId]
  );

  useEffect(() => {
    if (tab === "playlists" && playlists === null && !playlistsLoading) {
      void loadPlaylists(false);
    }
  }, [tab, playlists, playlistsLoading, loadPlaylists]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await vaultTubeApi.refreshSubscription(subId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synchronisation impossible.");
    } finally {
      setSyncing(false);
    }
  };

  const horizontal = useMemo(
    () => sortVideos(videos.filter((v) => !v.is_short), sort),
    [videos, sort]
  );
  const shorts = useMemo(
    () => sortVideos(videos.filter((v) => v.is_short), "recent"),
    [videos]
  );

  // Changer le tri ramène la liste à sa première tranche.
  const changeSort = (next: SortKey) => {
    setSort(next);
    setVideosShown(VIDEOS_PAGE);
  };

  const withChannel = (v: VaultTubeVideo) => ({
    ...v,
    channel: subscription?.name ?? null,
    channelAvatar: subscription?.thumbnail_url ?? null,
  });

  if (loading && videos.length === 0) {
    return <div className="afy-loader">Chargement de la chaîne…</div>;
  }

  const tabs: { key: Tab; label: string; count: string }[] = [
    { key: "videos", label: "Vidéos", count: String(horizontal.length) },
    { key: "shorts", label: "Shorts", count: String(shorts.length) },
    {
      key: "playlists",
      label: "Playlists",
      count: playlists === null ? "" : String(playlists.length),
    },
  ];

  return (
    <div>
      {subscription && (
        <header className="afy-sub-head">
          {subscription.thumbnail_url ? (
            <img className="afy-sub-head__avatar" src={subscription.thumbnail_url} alt="" />
          ) : (
            <div className="afy-sub-head__avatar afy-sub-head__avatar--fallback">
              {subscription.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="afy-sub-head__info">
            <h1 className="afy-sub-head__name">
              {subscription.name}
              <CheckCircle2 size={16} className="afy-sub-head__verified" />
            </h1>
            <div className="afy-sub-head__meta">
              <Users size={13} /> {horizontal.length} vidéo(s) • {shorts.length} short(s)
              {playlists !== null && <> • {playlists.length} playlist(s)</>}
            </div>
          </div>
          <button
            type="button"
            className="afy-btn-secondary"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw size={14} className={syncing ? "afy-spin" : undefined} />
            {syncing ? "Synchronisation…" : "Synchroniser"}
          </button>
        </header>
      )}

      {error && (
        <div className="afy-empty">
          <div className="afy-empty__title">{error}</div>
        </div>
      )}

      <div className="afy-tabs" role="tablist" aria-label="Contenu de la chaîne">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`afy-tab${tab === t.key ? " afy-tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count !== "" && <span className="afy-tab__count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ---------------- Vidéos (format horizontal) ---------------- */}
      {tab === "videos" && (
        <div role="tabpanel">
          {horizontal.length > 0 ? (
            <>
              <div className="afy-toolbar">
                <label className="afy-toolbar__label">
                  Trier par
                  <select
                    className="afy-select"
                    value={sort}
                    onChange={(e) => changeSort(e.target.value as SortKey)}
                  >
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <option key={k} value={k}>
                        {SORT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <section className="afy-row">
                <div className="afy-grid">
                  {horizontal.slice(0, videosShown).map((v) => (
                    <AetherFyVideoCard
                      key={`${v.source}-${v.youtube_id}`}
                      video={withChannel(v)}
                    />
                  ))}
                </div>
                {videosShown < horizontal.length && (
                  <div className="afy-more">
                    <button
                      type="button"
                      className="afy-btn-secondary"
                      onClick={() => setVideosShown((n) => n + VIDEOS_PAGE)}
                    >
                      Afficher plus ({horizontal.length - videosShown} restantes)
                    </button>
                  </div>
                )}
              </section>
            </>
          ) : (
            !loading &&
            !error && (
              <div className="afy-empty">
                <div className="afy-empty__title">
                  {videos.length === 0 ? "Aucune vidéo synchronisée" : "Aucune vidéo horizontale"}
                </div>
                {videos.length === 0 && (
                  <div>
                    Lancez une synchronisation pour récupérer les dernières vidéos de la chaîne.
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* ---------------- Shorts (format vertical) ---------------- */}
      {tab === "shorts" && (
        <div role="tabpanel">
          {shorts.length > 0 ? (
            <section className="afy-row">
              <div className="afy-grid afy-grid--shorts">
                {shorts.slice(0, shortsShown).map((v) => (
                  <AetherFyVideoCard
                    key={`s-${v.source}-${v.youtube_id}`}
                    video={withChannel(v)}
                    variant="short"
                  />
                ))}
              </div>
              {shortsShown < shorts.length && (
                <div className="afy-more">
                  <button
                    type="button"
                    className="afy-btn-secondary"
                    onClick={() => setShortsShown((n) => n + SHORTS_PAGE)}
                  >
                    Afficher plus ({shorts.length - shortsShown} restants)
                  </button>
                </div>
              )}
            </section>
          ) : (
            <div className="afy-empty">
              <div className="afy-empty__title">Aucun short pour cette chaîne</div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- Playlists ---------------- */}
      {tab === "playlists" && (
        <div role="tabpanel">
          <div className="afy-toolbar">
            <span className="afy-toolbar__label">Playlists publiques de la chaîne</span>
            <button
              type="button"
              className="afy-btn-secondary"
              onClick={() => void loadPlaylists(true)}
              disabled={playlistsLoading}
            >
              <RefreshCw size={14} className={playlistsLoading ? "afy-spin" : undefined} />
              Actualiser
            </button>
          </div>

          {playlistsLoading && playlists === null && (
            <div className="afy-loader">Synchronisation des playlists…</div>
          )}
          {playlistsError && (
            <div className="afy-empty">
              <div className="afy-empty__title">{playlistsError}</div>
            </div>
          )}
          {playlists !== null && playlists.length === 0 && !playlistsLoading && !playlistsError && (
            <div className="afy-empty">
              <div className="afy-empty__title">Aucune playlist publique trouvée</div>
            </div>
          )}
          {playlists !== null && playlists.length > 0 && (
            <section className="afy-row">
              <div className="afy-grid">
                {playlists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    className="afy-pl-card"
                    onClick={() =>
                      navigate(`/aetherfy/yt-playlist/${pl.youtube_id}`, {
                        state: {
                          title: pl.title,
                          channel: subscription?.name ?? null,
                          count: pl.video_count,
                        },
                      })
                    }
                  >
                    <div className="afy-pl-card__thumb">
                      {pl.thumbnail_url ? (
                        <img src={pl.thumbnail_url} alt="" loading="lazy" />
                      ) : (
                        <ListVideo size={36} />
                      )}
                      {pl.video_count != null && (
                        <span className="afy-pl-card__badge">
                          <ListVideo size={13} /> {pl.video_count}
                        </span>
                      )}
                    </div>
                    <div className="afy-pl-card__title">{pl.title}</div>
                    <div className="afy-pl-card__meta">
                      {pl.video_count != null ? `${pl.video_count} vidéos` : "Playlist"}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
