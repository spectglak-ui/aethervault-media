import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Clapperboard, ImageUp, ListPlus, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, CheckMenuItem } from "@tauri-apps/api/menu";
import { Button, EmptyState, IconButton, PageHeader } from "@aethervault/ui-kit";
import type { TitleDetails } from "@aethervault/shared-types";
import { titleApi } from "../features/title/api";
import { libraryApi } from "../features/library/api";
import { PersonalizableImage } from "../features/personalization/PersonalizableImage";
import { CastRow, GenreRow } from "../components/TitleRows";
import { usePlayer } from "../player/PlayerContext";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/** `"5432 s"` → `"1 h 30 min"` — registre différent de `formatTime`
 * (player/formatTime.ts) : celui-ci affiche une durée totale à l'échelle
 * d'une page de navigation. */
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

/** Charge une seule fois le script API IFrame YouTube (0.3.0). */
function loadYouTubeApi(): Promise<any> {
  return new Promise((resolve) => {
    const w = window as any;
    if (w.YT && w.YT.Player) {
      resolve(w.YT);
      return;
    }
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(w.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
}

/**
 * Page d'un Titre (doc §6.3).
 * 0.6.0 : (a) ORDRE CORRIGÉ — `trailerMode` déclaré AVANT `trailerActive`
 * (l'ordre inverse provoquait un ReferenceError au rendu) ;
 * (b) rangées « Distribution » (acteurs cliquables → page Personne) et
 * « Du même genre » en bas de page (composants partagés TitleRows).
 */
export function TitleDetailPage() {
  const { key, titleId } = useParams<{ key: string; titleId: string }>();
  const navigate = useNavigate();
  const { play, currentMedia } = usePlayer();
  const [title, setTitle] = useState<TitleDetails | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [trailerKeys, setTrailerKeys] = useState<string[]>([]);
  const [trailerKeyIndex, setTrailerKeyIndex] = useState(0);
  const trailerKey = trailerKeys[trailerKeyIndex] ?? null;
  // 0.6.0 : déclaration AVANT trailerActive (sinon ReferenceError TDZ).
  const [trailerMode, setTrailerMode] = useState<"backdrop" | "trailer">(() => {
    try {
      return localStorage.getItem("avm-title-trailer-mode") === "trailer" ? "trailer" : "backdrop";
    } catch {
      return "backdrop";
    }
  });
  // Le fond bande-annonce est DÉSACTIVÉ pendant toute lecture ; la
  // préférence utilisateur (localStorage) revient après la lecture.
  const trailerActive = trailerMode === "trailer" && !currentMedia;
  const [trailerSound, setTrailerSound] = useState(false);
  const wallpaperRef = useRef<HTMLDivElement | null>(null);
  const trailerHostRef = useRef<HTMLDivElement | null>(null);
  const trailerPlayerRef = useRef<any>(null);
  const [trailerRect, setTrailerRect] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!trailerActive || !trailerKey) return;
    const compute = () => {
      const el = wallpaperRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const ratio = 16 / 9;
      if (width / height > ratio) {
        setTrailerRect({ w: width, h: width / ratio });
      } else {
        setTrailerRect({ w: height * ratio, h: height });
      }
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [trailerActive, trailerKey]);

  useEffect(() => {
    if (!trailerActive || !trailerKey) return;
    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !trailerHostRef.current) return;
      trailerPlayerRef.current = new YT.Player(trailerHostRef.current, {
        width: "100%",
        height: "100%",
        videoId: trailerKey,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          loop: 1,
          playlist: trailerKey,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (event: any) => {
            try {
              event.target.unloadModule("captions");
              event.target.unloadModule("cc");
            } catch {
              // best-effort
            }
            if (trailerSound) event.target.unMute();
            else event.target.mute();
            event.target.playVideo();
          },
          onError: () => {
            console.warn("[trailer] erreur de lecture, essai de la vidéo suivante");
            setTrailerKeyIndex((idx) => {
              const next = idx + 1;
              return next < trailerKeys.length ? next : idx;
            });
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        trailerPlayerRef.current?.destroy();
      } catch {
        // best-effort
      }
      trailerPlayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailerActive, trailerKey]);

  useEffect(() => {
    const player = trailerPlayerRef.current;
    if (!player) return;
    try {
      if (trailerSound) player.unMute();
      else player.mute();
    } catch {
      // best-effort
    }
  }, [trailerSound]);

  const refresh = useCallback(() => {
    if (!titleId) return;
    titleApi
      .getDetails(Number(titleId))
      .then(setTitle)
      .catch(() => setTitle(null));
  }, [titleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 0.5.1 : TMDB d'abord ; si injoignable, repli YouTube local (yt-dlp).
  const titleName = title?.name ?? null;
  useEffect(() => {
    if (!titleId) return;
    let alive = true;
    const fallback = async (): Promise<string[]> => {
      if (!titleName) return [];
      try {
        const id = await invoke<string | null>("player_find_trailer", { title: titleName });
        return id ? [id] : [];
      } catch {
        return [];
      }
    };
    invoke<string[]>("get_title_trailer", { titleId: Number(titleId) })
      .then(async (keys) => (keys && keys.length > 0 ? keys : fallback()))
      .catch(() => fallback())
      .then((keys) => {
        if (!alive) return;
        setTrailerKeys(keys);
        setTrailerKeyIndex(0);
      });
    return () => {
      alive = false;
    };
  }, [titleId, titleName]);

  const handlePlay = async () => {
    if (!title || title.media_file_id === null) return;
    setStarting(true);
    try {
      const file = await libraryApi.getMediaFile(title.media_file_id);
      play({ id: file.id, title: title.name, path: file.path, libraryId: file.library_id });
    } catch (err) {
      console.warn("[title] lecture impossible :", err);
      window.alert(err instanceof Error ? err.message : "Lecture impossible (fichier indisponible ?).");
    } finally {
      setStarting(false);
    }
  };

  if (title === undefined) {
    return <p>Chargement…</p>;
  }
  if (title === null) {
    return <EmptyState title="Titre introuvable" description="Ce titre n'existe plus." />;
  }

  const banner = assetUrl(title.banner);
  const poster = assetUrl(title.poster);
  const wallpaper = banner ?? poster;

  const handlePickWallpaper = async () => {
    try {
      const sourcePath = await categoryApiPick();
      if (!sourcePath) return;
      await titleApi.setBanner(title.id, sourcePath);
      refresh();
    } catch (err) {
      console.warn("[title] changement de fond impossible :", err);
    }
  };
  const handleResetWallpaper = async () => {
    try {
      await titleApi.setBanner(title.id, null);
      refresh();
    } catch (err) {
      console.warn("[title] réinitialisation du fond impossible :", err);
    }
  };

  /** Étape 8 : menu natif « Ajouter à une collection ». */
  const openCollectionsMenu = async () => {
    try {
      const [all, mine] = await Promise.all([
        titleApi.listCollections(),
        titleApi.listCollectionsForTitle(title.id),
      ]);
      if (all.length === 0) {
        const name = window.prompt("Première collection — nom :");
        if (name && name.trim().length > 0) {
          await titleApi.createCollection(name.trim());
        }
        return;
      }
      const items = await Promise.all(
        all.map((collection) =>
          CheckMenuItem.new({
            text: collection.name,
            checked: mine.includes(collection.id),
            action: () => {
              const call = mine.includes(collection.id)
                ? titleApi.removeFromCollection(collection.id, title.id)
                : titleApi.addToCollection(collection.id, title.id);
              void call;
            },
          })
        )
      );
      const menu = await Menu.new({ items });
      await menu.popup();
    } catch {
      // best-effort
    }
  };

  return (
    <div className="avm-title-page">
      {trailerActive && trailerKey ? (
        <div
          ref={wallpaperRef}
          className="avm-title-page__wallpaper"
          aria-hidden="true"
          style={{ overflow: "hidden" }}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: trailerRect ? `${trailerRect.w}px` : "100%",
              height: trailerRect ? `${trailerRect.h}px` : "100%",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
            }}
          >
            <div ref={trailerHostRef} style={{ width: "100%", height: "100%" }} />
          </div>
          <div className="avm-title-page__wallpaper-overlay" />
        </div>
      ) : (
        wallpaper && (
          <div className="avm-title-page__wallpaper" aria-hidden="true">
            <img src={wallpaper} alt="" />
            <div className="avm-title-page__wallpaper-overlay" />
          </div>
        )
      )}
      <div className="avm-title-page__wallpaper-actions">
        <IconButton label="Ajouter à une collection" onClick={() => void openCollectionsMenu()}>
          <ListPlus size={16} />
        </IconButton>
        <IconButton label="Changer le fond de page" onClick={() => void handlePickWallpaper()}>
          <ImageUp size={16} />
        </IconButton>
        {title.banner_is_custom && (
          <IconButton
            label="Réinitialiser le fond automatique"
            onClick={() => void handleResetWallpaper()}
          >
            <RotateCcw size={16} />
          </IconButton>
        )}
        {trailerKey && (
          <IconButton
            label={
              trailerMode === "trailer" ? "Revenir au fond image" : "Bande-annonce en arrière-plan"
            }
            onClick={() => {
              const next = trailerMode === "trailer" ? "backdrop" : "trailer";
              setTrailerMode(next);
              try {
                localStorage.setItem("avm-title-trailer-mode", next);
              } catch {
                // best-effort
              }
            }}
          >
            <Clapperboard size={16} />
          </IconButton>
        )}
        {trailerKey && trailerActive && (
          <IconButton
            label={trailerSound ? "Couper le son de la bande-annonce" : "Activer le son"}
            onClick={() => setTrailerSound((s) => !s)}
          >
            {trailerSound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </IconButton>
        )}
      </div>
      <div className="avm-title-page__header">
        <div className="avm-title-page__poster">
          <PersonalizableImage
            src={poster}
            alt=""
            variant="poster"
            isCustom={title.poster_is_custom}
            onPick={async (sourcePath) => {
              try {
                await titleApi.setPoster(title.id, sourcePath);
                refresh();
              } catch (err) {
                console.warn("[title] changement d'affiche impossible :", err);
              }
            }}
            onReset={async () => {
              try {
                await titleApi.setPoster(title.id, null);
                refresh();
              } catch (err) {
                console.warn("[title] réinitialisation de l'affiche impossible :", err);
              }
            }}
          />
        </div>
        <div className="avm-title-page__info">
          <PageHeader
            title={title.name}
            description={[
              title.year,
              title.duration_seconds ? formatDuration(title.duration_seconds) : null,
              title.rating ? `★ ${title.rating.toFixed(1)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          {title.description && <p className="avm-title-page__description">{title.description}</p>}
          {title.genres.length > 0 && (
            <div className="avm-title-page__chips">
              {title.genres.map((genre) => (
                <span key={genre} className="avm-badge">
                  {genre}
                </span>
              ))}
            </div>
          )}
          {title.directors.length > 0 && (
            <p>
              <strong>Réalisation : </strong> {title.directors.join(", ")}
            </p>
          )}
          {title.cast.length > 0 && (
            <p>
              <strong>Casting : </strong>{" "}
              {title.cast
                .map((credit) =>
                  credit.character_name ? `${credit.name} (${credit.character_name})` : credit.name
                )
                .join(", ")}
            </p>
          )}
          {title.studios.length > 0 && (
            <p>
              <strong>Studios : </strong> {title.studios.join(", ")}
            </p>
          )}
          {title.kind === "movie" && (
            <Button
              variant="primary"
              onClick={handlePlay}
              disabled={starting || title.media_file_id === null}
            >
              <Play size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
              Lecture
            </Button>
          )}
        </div>
      </div>
      {title.technical &&
        (title.technical.resolutions.length > 0 ||
          title.technical.codecs.length > 0 ||
          title.technical.audio_langs.length > 0 ||
          title.technical.subtitle_langs.length > 0) && (
          <div className="avm-title-page__technical">
            <h3>Informations techniques</h3>
            <div className="avm-title-page__technical-grid">
              {title.technical.resolutions.length > 0 && (
                <div>
                  <span className="avm-technical-label">Résolution</span>
                  <div className="avm-technical-chips">
                    {title.technical.resolutions.map((res) => (
                      <span key={res} className="avm-badge avm-badge--info">
                        {res}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {title.technical.codecs.length > 0 && (
                <div>
                  <span className="avm-technical-label">Codec vidéo</span>
                  <div className="avm-technical-chips">
                    {title.technical.codecs.map((codec) => (
                      <span key={codec} className="avm-badge avm-badge--info">
                        {codec.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {title.technical.audio_langs.length > 0 && (
                <div>
                  <span className="avm-technical-label">Audio</span>
                  <div className="avm-technical-chips">
                    {title.technical.audio_langs.map((lang) => (
                      <span key={lang} className="avm-badge">
                        {lang.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {title.technical.subtitle_langs.length > 0 && (
                <div>
                  <span className="avm-technical-label">Sous-titres</span>
                  <div className="avm-technical-chips">
                    {title.technical.subtitle_langs.map((lang) => (
                      <span key={lang} className="avm-badge">
                        {lang.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      {title.kind === "series" && (
        <section className="avm-title-page__seasons">
          <h2>Saisons</h2>
          {title.seasons.length === 0 ? (
            <EmptyState
              title="Aucun épisode pour l'instant"
              description="Les épisodes apparaîtront ici après le prochain scan de la bibliothèque."
            />
          ) : (
            <ul className="avm-media-list">
              {title.seasons.map((season) => (
                <li
                  key={season.id}
                  className="avm-media-list__item avm-media-list__item--playable"
                  onClick={() => navigate(`/category/${key}/title/${titleId}/season/${season.id}`)}
                >
                  <span>{season.name ?? `Saison ${season.season_number}`}</span>
                  <span className="avm-card__subtitle">{season.episode_count} épisode(s)</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {/* 0.6.0 : rangées Distribution + Du même genre (zone basse). */}
            <CastRow titleId={title.id} />
      <GenreRow titleId={title.id} categoryKey={key ?? ""} />
    </div>
  );
}

/** Indirection pour conserver l'import categoryApi uniquement si présent
 * dans ton projet (pickImage). */
import { categoryApi } from "../features/category/api";
async function categoryApiPick(): Promise<string | null> {
  return categoryApi.pickImage();
}