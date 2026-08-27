import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ImageUp, Play, RotateCcw } from "lucide-react";
import { Button, EmptyState, IconButton, PageHeader } from "@aethervault/ui-kit";
import type { TitleDetails } from "@aethervault/shared-types";
import { titleApi } from "../features/title/api";
import { libraryApi } from "../features/library/api";
import { categoryApi } from "../features/category/api";
import { PersonalizableImage } from "../features/personalization/PersonalizableImage";
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

/**
 * Page d'un Titre (doc §6.3). Étape 7 (lot 4) : la bannière horizontale
 * est remplacée par un fond d'écran de page (bannière — ou affiche à
 * défaut — floutée + assombrie), personnalisé via les deux boutons en
 * haut à droite (même logique `custom_images` qu'avant, seul le rendu
 * change).
 */
export function TitleDetailPage() {
  const { key, titleId } = useParams<{ key: string; titleId: string }>();
  const navigate = useNavigate();
  const { play } = usePlayer();
  const [title, setTitle] = useState<TitleDetails | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);

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

  const handlePlay = async () => {
    if (!title || title.media_file_id === null) return;
    setStarting(true);
    try {
      const file = await libraryApi.getMediaFile(title.media_file_id);
      play({ id: file.id, title: title.name, path: file.path, libraryId: file.library_id });
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
    const sourcePath = await categoryApi.pickImage();
    if (!sourcePath) return;
    await titleApi.setBanner(title.id, sourcePath);
    refresh();
  };
  const handleResetWallpaper = async () => {
    await titleApi.setBanner(title.id, null);
    refresh();
  };

  return (
    <div className="avm-title-page">
      {wallpaper && (
        <div className="avm-title-page__wallpaper" aria-hidden="true">
          <img src={wallpaper} alt="" />
          <div className="avm-title-page__wallpaper-overlay" />
        </div>
      )}
      <div className="avm-title-page__wallpaper-actions">
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
      </div>

      <div className="avm-title-page__header">
        <div className="avm-title-page__poster">
          <PersonalizableImage
            src={poster}
            alt=""
            variant="poster"
            isCustom={title.poster_is_custom}
            onPick={async (sourcePath) => {
              await titleApi.setPoster(title.id, sourcePath);
              refresh();
            }}
            onReset={async () => {
              await titleApi.setPoster(title.id, null);
              refresh();
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
              <strong>Réalisation :</strong> {title.directors.join(", ")}
            </p>
          )}
          {title.cast.length > 0 && (
            <p>
              <strong>Casting :</strong>{" "}
              {title.cast
                .map((credit) =>
                  credit.character_name ? `${credit.name} (${credit.character_name})` : credit.name
                )
                .join(", ")}
            </p>
          )}
          {title.studios.length > 0 && (
            <p>
              <strong>Studios :</strong> {title.studios.join(", ")}
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
    </div>
  );
}