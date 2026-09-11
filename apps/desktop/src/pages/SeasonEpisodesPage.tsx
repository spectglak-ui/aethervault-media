import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Play, ScanLine } from "lucide-react";
import { Button, EmptyState, PageHeader } from "@aethervault/ui-kit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EpisodeSummary, PlayableMedia, TitleDetails } from "@aethervault/shared-types";
import { titleApi } from "../features/title/api";
import { libraryApi } from "../features/library/api";
import { usePlayer } from "../player/PlayerContext";
import { assetUrl } from "../lib/assetUrl";
import { CastRow, GenreRow } from "../components/TitleRows";
import "./pages.css";

/**
 * Liste des épisodes d'une Saison (doc §6.3, §6.7).
 * 0.6.0 : rangées « Distribution » + « Du même genre » en bas de page.
 */
export function SeasonEpisodesPage() {
  const { key: categoryKey, titleId, seasonId } = useParams<{
  key: string;
  titleId: string;
  seasonId: string;
}>();
  const { playQueue } = usePlayer();
  const [title, setTitle] = useState<TitleDetails | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [starting, setStarting] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);
  const [detectProgress, setDetectProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const titleIdRef = useRef<string | null>(null);
  titleIdRef.current = titleId ?? null;

  useEffect(() => {
    let u1: (() => void) | undefined;
    let u2: (() => void) | undefined;
    void listen<{ processed: number; total: number; current: string }>(
      "credits:progress",
      (e) => {
        setDetectProgress({ done: e.payload.processed, total: e.payload.total });
        setDetectStatus(
          `Analyse ${Math.min(e.payload.processed + 1, e.payload.total)}/${e.payload.total} : ${e.payload.current}`
        );
      }
    ).then((fn) => (u1 = fn));
    void listen<{ found: number }>("credits:done", (e) => {
      if (titleIdRef.current) {
        try {
          localStorage.setItem(`avm-credits-analyzed-${titleIdRef.current}`, "1");
        } catch {
          // ignore
        }
      }
      setDetecting(false);
      setDetectProgress(null);
      setDetectStatus(`${e.payload.found} segment(s) enregistré(s).`);
    }).then((fn) => (u2 = fn));
    return () => {
      u1?.();
      u2?.();
    };
  }, []);

  const handleDetect = () => {
    if (!titleId) return;
    setDetecting(true);
    setDetectStatus("Lancement de l'analyse audio…");
    void invoke("detect_credits", { titleId: Number(titleId) }).catch(() => {
      setDetecting(false);
      setDetectStatus("Échec de l'analyse.");
    });
  };

  useEffect(() => {
    if (!titleId || !episodes || episodes.length < 2 || detecting) return;
    try {
      if (localStorage.getItem(`avm-credits-analyzed-${titleId}`)) return;
    } catch {
      return;
    }
    const withFiles = episodes.filter((e) => e.media_file_id !== null);
    if (withFiles.length < 2) return;
    const firstId = withFiles[0].media_file_id as number;
    void invoke<{ segments: unknown[] }>("get_media_segment_context", {
      mediaFileId: firstId,
    })
      .then((ctx) => {
        if ((ctx?.segments?.length ?? 0) > 0) {
          try {
            localStorage.setItem(`avm-credits-analyzed-${titleId}`, "1");
          } catch {
            // ignore
          }
          return;
        }
        setDetecting(true);
        setDetectStatus("Analyse automatique des génériques…");
        void invoke("detect_credits", { titleId: Number(titleId) }).catch(() => {
          setDetecting(false);
          setDetectStatus("Échec de l'analyse.");
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleId, episodes]);

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
      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "0 0 12px" }}>
        <Button variant="secondary" onClick={handleDetect} disabled={detecting}>
          <ScanLine size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          {detecting ? "Analyse en cours…" : "Détecter les génériques"}
        </Button>
        {detectStatus && <span className="avm-settings-muted">{detectStatus}</span>}
      </div>
      {detecting && detectProgress && detectProgress.total > 0 && (
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "var(--color-surface-hover, #26262d)",
            overflow: "hidden",
            margin: "0 0 12px",
          }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((detectProgress.done / detectProgress.total) * 100)}
        >
          <div
            style={{
              width: `${Math.min(100, Math.round((detectProgress.done / detectProgress.total) * 100))}%`,
              height: "100%",
              background: "var(--color-accent, #7c5cff)",
              transition: "width 0.25s ease",
            }}
          />
        </div>
      )}
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
                  {episode.media_file_id !== null && (
                    <span className="avm-badge avm-badge--info" style={{ marginLeft: 8 }}>
                      Disponible
                    </span>
                  )}
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
      {/* 0.6.0 : rangées Distribution + Du même genre (zone basse). */}
      {titleId && <CastRow titleId={Number(titleId)} />}
      {titleId && <GenreRow titleId={Number(titleId)} categoryKey={categoryKey ?? ""} />}
    </div>
  );
}