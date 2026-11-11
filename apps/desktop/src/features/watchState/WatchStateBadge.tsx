import { Check, Eye, Play } from "lucide-react";
import { WATCH_STATE_LABELS, type WatchState } from "./api";
import "./watchState.css";

interface WatchStateBadgeProps {
  status: WatchState;
  /** Séries : épisodes vus / total (affichés pour « En cours »). */
  watched?: number;
  total?: number;
}

const ICONS = { todo: Eye, in_progress: Play, done: Check } as const;

/**
 * Petite annotation « À voir » / « En cours » / « Vu » (affiches, pages de
 * titre, listes d'épisodes). Pour une série « En cours », ajoute « 3/10 ».
 */
export function WatchStateBadge({ status, watched, total }: WatchStateBadgeProps) {
  const Icon = ICONS[status];
  const isSeries = total !== undefined && total > 1;
  const showCount = status === "in_progress" && isSeries && watched !== undefined;
  const tooltip = isSeries
    ? `${WATCH_STATE_LABELS[status]} — ${watched ?? 0} épisode(s) vu(s) sur ${total}`
    : WATCH_STATE_LABELS[status];
  return (
    <span className={`avm-watchstate avm-watchstate--${status}`} title={tooltip}>
      <Icon size={12} aria-hidden="true" />
      {WATCH_STATE_LABELS[status]}
      {showCount && <span className="avm-watchstate__count">{watched}/{total}</span>}
    </span>
  );
}

/** Fine barre de progression d'un média « En cours ». */
export function WatchProgressBar({ ratio }: { ratio: number | null | undefined }) {
  if (ratio === null || ratio === undefined) return null;
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  return (
    <div
      className="avm-watchprogress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Avancement"
    >
      <div className="avm-watchprogress__bar" style={{ width: `${percent}%` }} />
    </div>
  );
}
