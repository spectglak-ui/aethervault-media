import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ListVideo, Play } from "lucide-react";
import type { VaultTubeVideo } from "../vaulttube/api";
import { vaultTubeApi } from "../vaulttube/api";
import { AetherFyVideoCard } from "./AetherFyVideoCard";
import { setPlaylistSession } from "./playlistSession";

const PAGE = 48;

/**
 * Contenu d'une playlist PUBLIQUE d'une chaîne (ouverte depuis l'onglet
 * « Playlists » de la page de chaîne). Les vidéos sont lues en direct sur
 * YouTube (`previewVideos`) : le chargement peut prendre quelques secondes.
 */
export function AetherFyChannelPlaylistPage() {
  const { ytId } = useParams<{ ytId: string }>();
  const navigate = useNavigate();
  const state = (useLocation().state as {
    title?: string;
    channel?: string | null;
    count?: number | null;
  } | null) ?? null;

  const [videos, setVideos] = useState<VaultTubeVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const playlistKey = `yt:${ytId ?? ""}`;
  const playlistTitle = state?.title ?? "Playlist";

  const load = useCallback(async () => {
    if (!ytId) return;
    setVideos(null);
    setError(null);
    setShown(PAGE);
    try {
      setVideos(await vaultTubeApi.previewVideos(`https://www.youtube.com/playlist?list=${ytId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setVideos([]);
    }
  }, [ytId]);

  useEffect(() => {
    void load();
  }, [load]);

  const withChannel = useCallback(
    (v: VaultTubeVideo) => ({ ...v, channel: state?.channel ?? v.channel ?? null }),
    [state?.channel]
  );

  // La page de lecture lira cette liste : SEULEMENT les vidéos de la playlist, dans l'ordre.
  useEffect(() => {
    if (videos && videos.length > 0) {
      setPlaylistSession({ key: playlistKey, title: playlistTitle, videos: videos.map(withChannel) });
    }
  }, [videos, playlistKey, playlistTitle, withChannel]);

  const playAll = () => {
    const first = videos?.[0];
    if (first) {
      navigate(`/aetherfy/watch/${first.youtube_id}`, {
        state: { video: withChannel(first), playlistKey, playlistTitle },
      });
    }
  };

  return (
    <div>
      <header className="afy-sub-head">
        <button
          type="button"
          className="afy-topbar__back"
          onClick={() => navigate(-1)}
          title="Retour"
          aria-label="Retour"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="afy-sub-head__info">
          <h1 className="afy-sub-head__name">{playlistTitle}</h1>
          <div className="afy-sub-head__meta">
            <ListVideo size={13} />
            {videos === null
              ? "Chargement de la playlist…"
              : `${videos.length} vidéo(s)${state?.channel ? ` • ${state.channel}` : ""}`}
          </div>
        </div>
        <button
          type="button"
          className="afy-btn-secondary"
          onClick={playAll}
          disabled={!videos || videos.length === 0}
        >
          <Play size={14} /> Tout lire
        </button>
      </header>

      {videos === null && <div className="afy-loader">Chargement de la playlist…</div>}

      {error && (
        <div className="afy-empty">
          <div className="afy-empty__title">{error}</div>
          <button type="button" className="afy-btn-secondary" onClick={() => void load()}>
            Réessayer
          </button>
        </div>
      )}

      {videos !== null && videos.length === 0 && !error && (
        <div className="afy-empty">
          <div className="afy-empty__title">Cette playlist est vide</div>
        </div>
      )}

      {videos !== null && videos.length > 0 && (
        <section className="afy-row">
          <div className="afy-grid">
            {videos.slice(0, shown).map((v) => (
              <AetherFyVideoCard
                key={`${v.source}-${v.youtube_id}`}
                video={withChannel(v)}
                navState={{ playlistKey, playlistTitle }}
              />
            ))}
          </div>
          {shown < videos.length && (
            <div className="afy-more">
              <button
                type="button"
                className="afy-btn-secondary"
                onClick={() => setShown((n) => n + PAGE)}
              >
                Afficher plus ({videos.length - shown} restantes)
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
