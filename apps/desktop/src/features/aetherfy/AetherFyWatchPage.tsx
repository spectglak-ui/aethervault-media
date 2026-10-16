import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  ThumbsUp,
  ThumbsDown,
  Share2,
  Download,
  MoreHorizontal,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  MonitorPlay,
  PictureInPicture2,
  CheckCircle2,
} from "lucide-react";
import type { VaultTubeVideo, VaultTubeSubscription, Comment } from "../vaulttube/api";
import { vaultTubeApi, watchUrl } from "../vaulttube/api";
import { usePlayer } from "../../player/PlayerContext";
import { PlayerSurface } from "../../player/PlayerSurface";
import { AetherFyAmbientLight, useAmbientSettings } from "./AetherFyAmbientLight";
import { AetherFyPlaylistPanel } from "./AetherFyPlaylistPanel";
import { getPlaylistSession } from "./playlistSession";
import { AetherFyVideoCard } from "./AetherFyVideoCard";
import { useVisualizer } from "../../hooks/useVisualizer";
import { addToHistory, isInLiked, toggleLiked } from "./afyLibrary";

/* ------------------------------------------------------------------ */
/* 0.8.3 — Page de lecture AetherFy (version consolidée) :            */
/*  - historique local + état « J'aime » synchronisé afyLibrary ;     */
/*  - Partager = presse-papiers, Télécharger = commande Rust          */
/*    vaulttube_download_video (toast de confirmation) ;              */
/*  - sidebar playlist : abonnements ET playlists locales             */
/*    (playlistId/playlistTitle transmis via location.state) ;        */
/*  - verrou anti-overlay + halo pulsant + commentaires à la demande. */
/* ------------------------------------------------------------------ */

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(seconds?: number | null): string {
  return seconds ? formatClock(seconds) : "";
}

function initialFromChannel(channel?: string | null): string {
  if (!channel) return "YT";
  const clean = channel.replace(/[^a-zA-Z0-9]/g, "");
  return clean.slice(0, 2).toUpperCase() || "YT";
}

function relativeTime(epoch: number | null): string {
  if (!epoch) return "";
  const diff = Math.max(0, Date.now() - epoch * 1000);
  const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365));
  if (years > 0) return `${years} an${years > 1 ? "s" : ""}`;
  const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
  if (months > 0) return `${months} mois`;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days} jour${days > 1 ? "s" : ""}`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours > 0) return `${hours} h`;
  const minutes = Math.floor(diff / (1000 * 60));
  return `${minutes} min`;
}

export function AetherFyWatchPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Vidéo transmise par la carte via location.state (hors abonnements)
  const passedState =
    (location.state as {
      video?: VaultTubeVideo;
      playlistId?: number;
      playlistTitle?: string;
      /** Playlist publique d'une chaîne, lue en direct (voir `playlistSession.ts`). */
      playlistKey?: string;
    } | null) ?? null;
  const passedVideo = passedState?.video ?? null;

  const {
    playQueueBackground,
    immersiveOpen,
    openImmersive,
    closeAudioView,
    isDetached,
    toggleDetached,
    isPlaying,
    togglePlay,
    position,
    duration,
    buffered,
    seek,
    playNext,
    playPrevious,
    hasNext,
    hasPrevious,
    volume,
    muted,
    setVolumeLevel,
    toggleMuted,
    rate,
    setRate,
  } = usePlayer();

  const [ambient, setAmbient] = useAmbientSettings();
  const visualizer = useVisualizer();

  const [video, setVideo] = useState<VaultTubeVideo | null>(null);
  const [playlist, setPlaylist] = useState<VaultTubeVideo[]>([]);
  const [related, setRelated] = useState<VaultTubeVideo[]>([]);
  const [subscription, setSubscription] = useState<VaultTubeSubscription | null>(null);
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [playlistKey, setPlaylistKey] = useState<string | null>(null);
  const [playlistTitle, setPlaylistTitle] = useState<string | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [loop, setLoop] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  // Avance du préchargement sur la lecture (secondes) et niveau d'alerte.
  const aheadSeconds = Math.max(0, buffered - position);
  const aheadLevel = aheadSeconds < 3 ? "low" : aheadSeconds < 10 ? "mid" : "ok";

  // Callbacks STABLES : le panneau de file est mémoïsé et ne doit pas se
  // re-rendre à chaque événement de position du lecteur.
  const toggleLoop = useCallback(() => setLoop((l) => !l), []);
  const toggleShuffle = useCallback(() => setShuffle((x) => !x), []);
  const closePlaylist = useCallback(() => navigate(-1), [navigate]);
  const [error, setError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [localFs, setLocalFs] = useState(false);
  const [wantsImmersive, setWantsImmersive] = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  };

  const currentIndex = useMemo(
    () => (video ? playlist.findIndex((v) => v.youtube_id === video.youtube_id) : -1),
    [video, playlist]
  );

  const loadVideo = useCallback(async () => {
    if (!videoId) return;
    setError(null);
    try {
      // Playlist publique d'une chaîne : la liste de droite contient SEULEMENT
      // ses vidéos, dans son ordre (jamais celles de l'abonnement).
      const session = getPlaylistSession(passedState?.playlistKey);
      if (session) {
        const found = session.videos.find((v) => v.youtube_id === videoId) ?? passedVideo;
        if (found) {
          setVideo(found);
          setPlaylist(session.videos);
          setPlaylistId(null);
          setPlaylistKey(session.key);
          setPlaylistTitle(session.title);
          setSubscription(null);
          setRelated([]);
          return;
        }
      }

      // 0.8.2 : ouverture depuis une playlist locale → la sidebar montre
      // CETTE playlist, pas les vidéos d'un abonnement.
      if (passedState?.playlistId) {
        const items = await vaultTubeApi.listUserPlaylistItems(passedState.playlistId);
        const mapped: VaultTubeVideo[] = items.map((it) => ({
          id: it.id,
          subscription_id: 0,
          youtube_id: it.youtube_id,
          title: it.title,
          description: null,
          thumbnail_url: it.thumbnail_url,
          duration_seconds: it.duration_seconds,
          published_at: null,
          added_at: it.added_at,
          source: it.source,
          mode: it.mode,
          is_short: false,
        }));
        const found = mapped.find((v) => v.youtube_id === videoId) ?? passedVideo ?? null;
        if (found) {
          setVideo(found);
          setPlaylist(mapped);
          setPlaylistId(passedState.playlistId);
          setPlaylistKey(null);
          setPlaylistTitle(passedState.playlistTitle ?? "Playlist locale");
          setSubscription(null);
          setRelated([]);
          return;
        }
      }

      const subs = await vaultTubeApi.listSubscriptions();
      for (const sub of subs) {
        try {
          const vids = await vaultTubeApi.listVideos(sub.id);
          const found = vids.find((v) => v.youtube_id === videoId);
          if (found) {
            setVideo(found);
            setPlaylist(vids);
            setSubscription(sub);
            setPlaylistId(null);
            setPlaylistKey(null);
            setPlaylistTitle(null);
            const idx = vids.findIndex((v) => v.youtube_id === videoId);
            const following = vids.slice(idx + 1, idx + 8);
            const others: VaultTubeVideo[] = [];
            for (const other of subs) {
              if (other.id === sub.id) continue;
              try {
                others.push(...(await vaultTubeApi.listVideos(other.id)).slice(0, 2));
              } catch {
                /* abonnement indisponible : ignoré */
              }
              if (others.length >= 4) break;
            }
            setRelated([...following, ...others]);
            return;
          }
        } catch {
          /* abonnement illisible : on passe au suivant */
        }
      }

      // 0.8.0 : vidéo hors abonnements (Tendances, Directs, recherche…)
      if (passedVideo && passedVideo.youtube_id === videoId) {
        setVideo(passedVideo);
        setPlaylist([passedVideo]);
        setSubscription(null);
        setPlaylistId(null);
        setPlaylistKey(null);
        setPlaylistTitle(null);
        return;
      }

      setVideo(null);
      setError("Vidéo non présente dans vos abonnements synchronisés.");
    } catch (err) {
      console.error("[AetherFy] Vidéo introuvable", err);
      setError("Chargement impossible.");
    }
  }, [videoId, passedVideo, passedState]);

  useEffect(() => {
    void loadVideo();
  }, [loadVideo]);

  /* 0.8.0 : alimente l'historique local à chaque vidéo ouverte. */
  useEffect(() => {
    if (!video) return;
    addToHistory({
      youtube_id: video.youtube_id,
      source: video.source,
      title: video.title,
      thumbnail_url: video.thumbnail_url,
      channel: video.channel ?? subscription?.name ?? null,
      duration_seconds: video.duration_seconds,
      added_at: Math.floor(Date.now() / 1000),
    });
  }, [video, subscription]);

  /* 0.8.2 : état « J'aime » synchronisé avec la liste locale. */
  useEffect(() => {
    if (!video) return;
    setLiked(isInLiked(video.youtube_id));
    setDisliked(false);
  }, [video]);

  /* Verrou anti-overlay : tout overlay immersif ouvert par un émetteur
     parasite est refermé ; l'ouverture volontaire (wantsImmersive) est
     respectée ; le flag retombe à la fermeture. */
  useEffect(() => {
    closeAudioView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!immersiveOpen) {
      if (wantsImmersive) setWantsImmersive(false);
      return;
    }
    if (!wantsImmersive) closeAudioView();
  }, [immersiveOpen, wantsImmersive, closeAudioView]);

  /* File complète, lecture « en place » : sans `mode`, via ref
     (pas de relance à chaque tick player-state). */
  const playQueueBackgroundRef = useRef(playQueueBackground);
  playQueueBackgroundRef.current = playQueueBackground;

  useEffect(() => {
    if (!video || playlist.length === 0) return;
    const items = playlist.map((v, i) => ({
      id: v.id || i + 1,
      title: v.title,
      path: watchUrl(v.source, v.youtube_id),
      libraryId: -1,
    }));
    const index = playlist.findIndex((v) => v.youtube_id === video.youtube_id);
    playQueueBackgroundRef.current(items, index === -1 ? 0 : index);
  }, [video, playlist]);

  /* Plein écran local : suivi de l'état natif. */
  useEffect(() => {
    const onChange = () => setLocalFs(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleLocalFs = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void wrapRef.current?.requestFullscreen();
    }
  };

  /* ----- actions métadonnées ----- */

  const handleLike = () => {
    if (!video) return;
    const next = !liked;
    setLiked(next);
    setDisliked(false);
    toggleLiked({
      youtube_id: video.youtube_id,
      source: video.source,
      title: video.title,
      thumbnail_url: video.thumbnail_url,
      channel: video.channel ?? subscription?.name ?? null,
      duration_seconds: video.duration_seconds,
      added_at: Math.floor(Date.now() / 1000),
    });
    showToast(next ? "Ajoutée aux vidéos aimées ♥" : "Retirée des vidéos aimées");
  };

  const handleShare = () => {
    if (!video) return;
    const url = watchUrl(video.source, video.youtube_id);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => showToast("Lien copié dans le presse-papiers"),
        () => window.prompt("Copiez le lien :", url)
      );
    } else {
      window.prompt("Copiez le lien :", url);
    }
  };

  const handleDownload = () => {
    if (!video) return;
    showToast("Préparation du téléchargement…");
    try {
      vaultTubeApi
        .downloadVideo(video.youtube_id, video.source)
        .then((dest) => showToast(`Téléchargement lancé → ${dest}`))
        .catch(() => showToast("Téléchargement impossible"));
    } catch {
      showToast("Téléchargement indisponible (commande Rust manquante)");
    }
  };

  /* ----- commentaires ----- */

  const loadComments = useCallback(async () => {
    if (!video || commentsLoading) return;
    setCommentsLoading(true);
    try {
      const list = await vaultTubeApi.getComments(video.youtube_id, video.source);
      setComments(list);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [video, commentsLoading]);

  const handleToggleComments = () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next && comments.length === 0) void loadComments();
  };

  if (error) {
    return (
      <div className="afy-empty">
        <div className="afy-empty__title">{error}</div>
        <button type="button" className="afy-btn-secondary" onClick={() => navigate(-1)}>
          Retour
        </button>
      </div>
    );
  }

  if (!video) {
    return <div className="afy-loader">Chargement de la vidéo…</div>;
  }

  const channelName = subscription?.name ?? "Chaîne";
  const sideTitle = playlistTitle ?? subscription?.name ?? "Playlist";
  const haloOpacity = ambient.enabled ? 0.3 + visualizer.pulse * 0.5 : 0;
  const statsParts = [
    video.published_at
      ? `publiée le ${new Date(video.published_at * 1000).toLocaleDateString("fr-FR")}`
      : null,
    video.duration_seconds ? formatDuration(video.duration_seconds) : null,
    video.source || null,
  ].filter(Boolean) as string[];

  return (
    <div className="afy-watch">
      <div className="afy-watch__primary">
        {/* ----- PLAYER INLINE ----- */}
        <div className="afy-player-wrap" ref={wrapRef}>
          {ambient.enabled && video.thumbnail_url && (
            <div
              className="afy-player-halo"
              style={{
                backgroundImage: `url(${video.thumbnail_url})`,
                filter: `blur(${ambient.blur}px)`,
                transform: `scale(${ambient.spread / 100})`,
                opacity: haloOpacity,
              }}
            />
          )}

          {immersiveOpen ? (
            <div className="afy-player-placeholder">Lecture dans la vue classique…</div>
          ) : isDetached ? (
            <div className="afy-player-placeholder">
              <span>Lecture dans la fenêtre flottante…</span>
              <button
                type="button"
                className="afy-controls__btn"
                style={{ marginLeft: 12 }}
                onClick={toggleDetached}
                title="Ramener la vidéo dans cette page"
              >
                Revenir ici
              </button>
            </div>
          ) : (
            <PlayerSurface />
          )}

          {!immersiveOpen && !isDetached && (
            <div className={`afy-controls${!isPlaying ? " afy-controls--visible" : ""}`}>
              {/* Barre de lecture à trois couches : piste, PRÉCHARGEMENT (vert,
                  jusqu'où mpv a déjà en tampon) et lecture (rose) ; le curseur
                  natif, transparent, reste au-dessus pour le clic. Le vert qui
                  dépasse le rose = le préchargement devance la lecture. */}
              <div
                className="afy-seek"
                title={
                  duration > 0
                    ? `Préchargement : ${
                        aheadSeconds > 0 ? `+${Math.round(aheadSeconds)} s d'avance` : "aucune avance"
                      }`
                    : undefined
                }
              >
                <div className="afy-seek__track" />
                {duration > 0 && buffered > position && (
                  <div
                    className="afy-seek__buffered"
                    style={{ width: `${Math.min(100, (buffered / duration) * 100)}%` }}
                  />
                )}
                <div
                  className="afy-seek__played"
                  style={{
                    width: `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%`,
                  }}
                />
                <input
                  type="range"
                  className="afy-controls__seek afy-seek__input"
                  min={0}
                  max={Math.max(0, duration)}
                  step={1}
                  value={Math.min(position, duration || 0)}
                  onChange={(e) => seek(Number(e.target.value))}
                />
              </div>
              <div className="afy-controls__row">
                <button
                  type="button"
                  className="afy-controls__btn"
                  onClick={togglePlay}
                  title={isPlaying ? "Pause" : "Lecture"}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button
                  type="button"
                  className="afy-controls__btn"
                  onClick={playPrevious}
                  disabled={!hasPrevious}
                  title="Précédent"
                >
                  <SkipBack size={16} />
                </button>
                <button
                  type="button"
                  className="afy-controls__btn"
                  onClick={playNext}
                  disabled={!hasNext}
                  title="Suivant"
                >
                  <SkipForward size={16} />
                </button>
                <span className="afy-controls__time">
                  {formatClock(position)} / {formatClock(duration)}
                  {duration > 0 && (
                    <span
                      className={`afy-controls__ahead afy-controls__ahead--${aheadLevel}`}
                      title="Avance du préchargement sur la lecture"
                    >
                      {" "}
                      · +{Math.round(aheadSeconds)} s
                    </span>
                  )}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="afy-controls__btn"
                  onClick={toggleMuted}
                  title={muted ? "Réactiver le son" : "Couper le son"}
                >
                  {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  className="afy-controls__vol"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => setVolumeLevel(Number(e.target.value))}
                />
                <select
                  className="afy-controls__rate"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                  title="Vitesse de lecture"
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="afy-controls__btn"
                  onClick={toggleLocalFs}
                  title="Plein écran"
                >
                  {localFs ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
                <button
                  type="button"
                  className="afy-controls__btn"
                  onClick={toggleDetached}
                  title="Lecteur flottant (PiP)"
                >
                  <PictureInPicture2 size={16} />
                </button>
                <button
                  type="button"
                  className="afy-controls__btn"
                  onClick={() => {
                    setWantsImmersive(true);
                    openImmersive();
                  }}
                  title="Ouvrir la vue classique"
                >
                  <MonitorPlay size={16} />
                </button>
              </div>
            </div>
          )}
          <AetherFyAmbientLight settings={ambient} onChange={setAmbient} />
        </div>

        {/* ----- MÉTADONNÉES ----- */}
        <div className="afy-watch__meta">
          <h1 className="afy-watch__title">{video.title}</h1>
          <div className="afy-watch__actions">
            <div className="afy-channel">
              <div className="afy-channel__avatar">
                {subscription?.thumbnail_url ? (
                  <img src={subscription.thumbnail_url} alt="" />
                ) : (
                  initialFromChannel(channelName)
                )}
              </div>
              <div className="afy-channel__info">
                <div className="afy-channel__name">{channelName}</div>
                {subscription && <div className="afy-channel__subs">Abonné</div>}
              </div>
              {subscription ? (
                <button
                  type="button"
                  className="afy-action-btn"
                  disabled
                  title="Vous suivez déjà cette chaîne"
                >
                  <CheckCircle2 size={14} /> Abonné
                </button>
              ) : (
                <button type="button" className="afy-action-btn afy-action-btn--primary">
                  S'abonner
                </button>
              )}
            </div>

            <div className="afy-action-btn__split">
              <button
                type="button"
                className={liked ? "afy-split-active" : undefined}
                onClick={handleLike}
                title="J'aime"
              >
                <ThumbsUp size={14} /> J'aime
              </button>
              <span className="afy-action-btn__split-divider" />
              <button
                type="button"
                className={disliked ? "afy-split-active" : undefined}
                onClick={() => {
                  setDisliked((v) => !v);
                  setLiked(false);
                }}
                title="Je n'aime pas"
              >
                <ThumbsDown size={14} />
              </button>
            </div>

            <button type="button" className="afy-action-btn" onClick={handleShare}>
              <Share2 size={14} /> Partager
            </button>
            <button type="button" className="afy-action-btn" onClick={handleDownload}>
              <Download size={14} /> Télécharger
            </button>
            <button type="button" className="afy-action-btn">
              <MoreHorizontal size={14} />
            </button>
          </div>

          {(video.description || statsParts.length > 0) && (
            <div
              className={`afy-description${descriptionExpanded ? " afy-description--expanded" : ""}`}
            >
              {statsParts.length > 0 && (
                <div className="afy-description__stats">{statsParts.join(" • ")}</div>
              )}
              {video.description && (
                <div className="afy-description__text">{video.description}</div>
              )}
              {video.description && video.description.length > 200 && (
                <button
                  type="button"
                  className="afy-description__toggle"
                  onClick={() => setDescriptionExpanded((e) => !e)}
                >
                  {descriptionExpanded ? "Afficher moins" : "…plus"}
                </button>
              )}
            </div>
          )}

          <div className="afy-comments">
            <button type="button" className="afy-comments__head" onClick={handleToggleComments}>
              <MessageSquare size={18} />
              <span>
                {comments.length > 0 ? `${comments.length} commentaires` : "Commentaires"}
              </span>
              {commentsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {commentsOpen && (
              <div className="afy-comments__body">
                {commentsLoading ? (
                  <div className="afy-comments__loading">
                    <Loader2 size={16} className="afy-spin" /> Chargement…
                  </div>
                ) : comments.length === 0 ? (
                  <div className="afy-comments__empty">Aucun commentaire disponible.</div>
                ) : (
                  comments.slice(0, 20).map((c) => (
                    <div key={c.id} className="afy-comment">
                      <div className="afy-comment__avatar">{initialFromChannel(c.author)}</div>
                      <div className="afy-comment__body">
                        <div className="afy-comment__head">
                          <span className="afy-comment__author">{c.author}</span>
                          {c.published_at && (
                            <span className="afy-comment__time">
                              il y a {relativeTime(c.published_at)}
                            </span>
                          )}
                        </div>
                        <div className="afy-comment__text">{c.text}</div>
                        {c.likes !== null && c.likes > 0 && (
                          <div className="afy-comment__likes">
                            <ThumbsUp size={12} /> {c.likes}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ----- SIDEBAR PLAYLIST (abonnement OU playlist locale) ----- */}
      <aside className="afy-watch__aside">
        {playlist.length > 0 && (subscription || playlistTitle) && (
          <AetherFyPlaylistPanel
            playlist={playlist}
            activeYoutubeId={video.youtube_id}
            sideTitle={sideTitle}
            playlistId={playlistId}
            playlistKey={playlistKey}
            playlistTitle={playlistTitle}
            loop={loop}
            shuffle={shuffle}
            onToggleLoop={toggleLoop}
            onToggleShuffle={toggleShuffle}
            onClose={closePlaylist}
          />
        )}
        {related.length > 0 && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>À suivre</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {related.slice(0, 6).map((v) => (
                <AetherFyVideoCard key={`${v.source}-${v.youtube_id}`} video={v} />
              ))}
            </div>
          </div>
        )}
      </aside>

      {toast && <div className="afy-toast">{toast}</div>}
    </div>
  );
}