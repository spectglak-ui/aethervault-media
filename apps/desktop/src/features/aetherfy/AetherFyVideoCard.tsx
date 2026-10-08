import type { VaultTubeVideo } from "../vaulttube/models";
import { useNavigate } from "react-router-dom";
import { BadgeCheck } from "lucide-react";

function formatDuration(seconds?: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function formatViews(views?: number | null): string {
  if (!views) return "";
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1).replace(".0", "")} M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(0)} k`;
  return String(views);
}
function initialFromChannel(channel?: string | null): string {
  if (!channel) return "YT";
  const clean = channel.replace(/[^a-zA-Z0-9]/g, "");
  return clean.slice(0, 2).toUpperCase() || "YT";
}
function relativeTime(isoOrEpoch: string | number): string {
  const then = typeof isoOrEpoch === "number" ? isoOrEpoch * 1000 : new Date(isoOrEpoch).getTime();
  const diff = Math.max(0, Date.now() - then);
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

interface Props {
  video: VaultTubeVideo & { channelAvatar?: string | null };
  live?: boolean;
  verified?: boolean;
  variant?: "normal" | "short";
  /** 0.8.2 : contexte additionnel transmis à la page watch
      (ex. { playlistId, playlistTitle } depuis une playlist locale). */
  navState?: Record<string, unknown>;
}

export function AetherFyVideoCard({ video, live, verified, variant = "normal", navState }: Props) {
  const navigate = useNavigate();
  const channelAvatar = video.channelAvatar ?? null;
  const handleClick = () => {
    navigate(`/aetherfy/watch/${video.youtube_id}`, { state: { video, ...(navState ?? {}) } });
  };

  if (variant === "short") {
    return (
      <button type="button" className="afy-card afy-card--short" onClick={handleClick}>
        <div className="afy-card__thumb-wrap">
          {video.thumbnail_url ? (
            <img src={video.thumbnail_url} alt={video.title} loading="lazy" className="afy-card__thumb" />
          ) : (
            <div className="afy-card__thumb" />
          )}
        </div>
        <div className="afy-card__info">
          <h3 className="afy-card__title">{video.title}</h3>
          <div className="afy-card__stats">{video.views ? `${formatViews(video.views)} vues` : ""}</div>
        </div>
      </button>
    );
  }

  return (
    <button type="button" className="afy-card" onClick={handleClick}>
      <div className="afy-card__thumb-wrap">
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt={video.title} loading="lazy" className="afy-card__thumb" />
        ) : (
          <div className="afy-card__thumb" />
        )}
        {live ? (
          <span className="afy-card__live-dot">En direct</span>
        ) : (
          video.duration_seconds != null && (
            <span className="afy-card__duration">{formatDuration(video.duration_seconds)}</span>
          )
        )}
      </div>
      <div className="afy-card__body">
        <div className="afy-card__avatar">
          {channelAvatar ? <img src={channelAvatar} alt="" loading="lazy" /> : initialFromChannel(video.channel)}
        </div>
        <div className="afy-card__info">
          <h3 className="afy-card__title">{video.title}</h3>
          <div className="afy-card__channel">
            {video.channel ?? "Chaîne"}
            {verified && <BadgeCheck size={12} className="afy-card__verified" />}
          </div>
          <div className="afy-card__stats">
            {video.views ? `${formatViews(video.views)} vues` : ""}
            {video.views && video.published_at ? " • " : ""}
            {video.published_at ? `il y a ${relativeTime(video.published_at)}` : ""}
          </div>
        </div>
      </div>
    </button>
  );
}