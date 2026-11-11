import { Eye, EyeOff, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@aethervault/ui-kit";
import type { TitleDetails } from "@aethervault/shared-types";
import { formatTime } from "../../player/formatTime";
import { WatchProgressBar, WatchStateBadge } from "./WatchStateBadge";
import { useMediaWatchStates, useResumeTarget, useTitleWatchStates } from "./useWatchStates";
import { watchStateApi, type WatchState } from "./api";
import "./watchState.css";

interface TitleWatchPanelProps {
  title: TitleDetails;
  /** Clé de catégorie de la route (`/category/:key/...`). */
  categoryKey: string;
  starting: boolean;
  /** Lecture du film (reprend automatiquement à la position sauvegardée). */
  onPlayMovie: () => void;
}

/**
 * Page d'un titre : statut de visionnage, bouton de lecture « intelligent »
 * (Lecture / Reprendre à 42:10 / Revoir pour un film ; Commencer / Reprendre /
 * Épisode suivant pour une série) et marquage manuel Vu / non vu.
 */
export function TitleWatchPanel({ title, categoryKey, starting, onPlayMovie }: TitleWatchPanelProps) {
  const navigate = useNavigate();
  const isMovie = title.kind === "movie";
  const movieFileId = isMovie ? title.media_file_id : null;
  const mediaStates = useMediaWatchStates(movieFileId !== null ? [movieFileId] : null);
  const titleStates = useTitleWatchStates([title.id]);
  const resume = useResumeTarget(isMovie ? null : title.id);

  const state = titleStates[title.id];
  const status: WatchState = state?.status ?? "todo";
  const media = movieFileId !== null ? mediaStates[movieFileId] : undefined;
  const hasMedia = isMovie ? movieFileId !== null : (state?.total ?? 0) > 0;

  const toggleSeen = () => {
    const next = status === "done" ? "todo" : "done";
    if (!isMovie && !window.confirm(
      next === "done"
        ? "Marquer tous les épisodes de cette série comme vus ?"
        : "Remettre tous les épisodes de cette série à « À voir » ? Les positions de reprise seront effacées."
    )) {
      return;
    }
    void watchStateApi.setTitleStatus(title.id, next).catch(() => {});
  };

  let playLabel = "Lecture";
  if (isMovie) {
    if (media?.status === "in_progress" && media.position_seconds) {
      playLabel = `Reprendre à ${formatTime(media.position_seconds)}`;
    } else if (status === "done") {
      playLabel = "Revoir";
    }
  } else if (resume) {
    const episode = `S${resume.season_number} · É${resume.episode_number}`;
    if (resume.status === "in_progress") {
      playLabel =
        resume.resume_seconds && resume.resume_seconds > 0
          ? `Reprendre ${episode} à ${formatTime(resume.resume_seconds)}`
          : `Reprendre ${episode}`;
    } else if ((state?.watched ?? 0) > 0) {
      playLabel = `Épisode suivant · ${episode}`;
    } else {
      playLabel = `Commencer · ${episode}`;
    }
  }

  const playDisabled = isMovie ? starting || movieFileId === null : !resume;

  return (
    <div className="avm-watchpanel-wrap">
      <div className="avm-watchpanel">
        <WatchStateBadge status={status} watched={state?.watched} total={state?.total} />
        {isMovie && media?.status === "in_progress" && (
          <div style={{ width: 120 }}>
            <WatchProgressBar ratio={media.progress_ratio} />
          </div>
        )}
        {!isMovie && state && state.total > 1 && (
          <span className="avm-watchpanel__hint">
            {state.watched}/{state.total} épisodes vus
          </span>
        )}
      </div>
      <div className="avm-watchpanel">
        {(isMovie || resume) && (
          <Button
            variant="primary"
            disabled={playDisabled}
            onClick={() => {
              if (isMovie) {
                onPlayMovie();
              } else if (resume) {
                navigate(
                  `/category/${categoryKey}/title/${title.id}/season/${resume.season_id}?play=${resume.episode_id}`
                );
              }
            }}
          >
            <Play size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
            {playLabel}
          </Button>
        )}
        {hasMedia && (
          <Button variant="secondary" onClick={toggleSeen}>
            {status === "done" ? (
              <EyeOff size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
            ) : (
              <Eye size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
            )}
            {status === "done" ? "Marquer comme non vu" : "Marquer comme vu"}
          </Button>
        )}
      </div>
    </div>
  );
}
