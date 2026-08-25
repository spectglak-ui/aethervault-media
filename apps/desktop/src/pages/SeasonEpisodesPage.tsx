import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Play } from "lucide-react";
import { EmptyState, PageHeader } from "@aethervault/ui-kit";
import type { EpisodeSummary, PlayableMedia, TitleDetails } from "@aethervault/shared-types";
import { titleApi } from "../features/title/api";
import { libraryApi } from "../features/library/api";
import { usePlayer } from "../player/PlayerContext";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/**
 * Liste des épisodes d'une Saison (doc §6.3, §6.7). Cliquer un épisode
 * construit la file de lecture (Queue, §4.2 bis) à partir de **tous les
 * épisodes de cette saison qui ont un fichier associé**, dans leur ordre
 * d'affichage — c'est ce qui permet à Précédent/Suivant (Étape 3e) de
 * parcourir les épisodes d'une série exactement comme VLC/MPC-HC le font
 * pour un dossier ouvert. Construite à la demande, au clic, plutôt que
 * précalculée à l'affichage de la page : les fichiers ne sont résolus
 * (`getMediaFile`) que si l'utilisateur lance vraiment la lecture.
 */
export function SeasonEpisodesPage() {
  const { titleId, seasonId } = useParams<{ key: string; titleId: string; seasonId: string }>();
  const { playQueue } = usePlayer();

  const [title, setTitle] = useState<TitleDetails | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [starting, setStarting] = useState<number | null>(null);

  const refresh = useCallback(() => {
    if (!titleId || !seasonId) return;
    titleApi.getDetails(Number(titleId)).then(setTitle).catch(() => setTitle(null));
    titleApi
      .listEpisodes(Number(seasonId))
      .then(setEpisodes)
      .catch(() => setEpisodes([]));
  }, [titleId, seasonId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const season = title?.seasons.find((candidate) => String(candidate.id) === seasonId);
  const seasonLabel = season ? season.name ?? `Saison ${season.season_number}` : "";

  const handlePlay = async (clickedEpisode: EpisodeSummary) => {
    if (!episodes || !title) return;
    setStarting(clickedEpisode.id);

    try {
      // Chaque entrée résolue porte l'id de son épisode d'origine plutôt
      // que de compter sur la position dans le tableau : après le filtre
      // ci-dessous (épisodes sans fichier exclus), l'index dans `items` ne
      // correspond plus à l'index dans `episodes` — chercher l'épisode
      // cliqué par position aurait pointé sur la mauvaise entrée dès qu'un
      // épisode sans fichier précède celui cliqué.
      const resolved = await Promise.all(
        episodes.map(async (episode) => {
          if (episode.media_file_id === null) return null;
          const file = await libraryApi.getMediaFile(episode.media_file_id);
          const media: PlayableMedia = {
            id: file.id,
            title: episode.name
              ? `${title.name} — ${episode.name}`
              : `${title.name} — Épisode ${episode.episode_number}`,
            path: file.path,
            libraryId: file.library_id,
          };
          return { episodeId: episode.id, media };
        })
      );

      const items = resolved.filter(
        (entry): entry is { episodeId: number; media: PlayableMedia } => entry !== null
      );
      const startIndex = items.findIndex((entry) => entry.episodeId === clickedEpisode.id);

      if (startIndex !== -1) {
        playQueue(
          items.map((entry) => entry.media),
          startIndex
        );
      }
    } finally {
      setStarting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={title ? `${title.name}${seasonLabel ? ` — ${seasonLabel}` : ""}` : "Épisodes"}
      />

      {episodes === null && <p>Chargement…</p>}

      {episodes !== null && episodes.length === 0 && (
        <EmptyState
          title="Aucun épisode"
          description="Cette saison ne contient aucun épisode pour l'instant."
        />
      )}

      {episodes !== null && episodes.length > 0 && (
        <ul className="avm-media-list">
          {episodes.map((episode) => {
            const still = assetUrl(episode.still);
            return (
              <li
                key={episode.id}
                className="avm-media-list__item avm-media-list__item--playable avm-episode-row"
                onClick={() => handlePlay(episode)}
              >
                {still && <img src={still} alt="" className="avm-episode-row__still" />}
                <div className="avm-episode-row__info">
                  <span>
                    {episode.episode_number}. {episode.name ?? `Épisode ${episode.episode_number}`}
                  </span>
                  {episode.description && (
                    <span className="avm-card__subtitle">{episode.description}</span>
                  )}
                </div>
                <Play size={16} style={{ opacity: starting === episode.id ? 0.5 : 1 }} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
