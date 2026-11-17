import { Link } from "react-router-dom";
import { Loader2, Music2, Play } from "lucide-react";
import { formatDuration, type MusicTrack } from "./api";

interface TrackRowProps {
  track: MusicTrack;
  busy: boolean;
  /** Affiche le numéro de piste au lieu de la pochette (page d'un album). */
  numbered?: boolean;
  /** Masque l'album (déjà connu dans la page d'un album). */
  hideAlbum?: boolean;
  onPlay: (track: MusicTrack) => void;
}

/** Une ligne de titre : un clic cherche la bonne version et la lit. */
export function TrackRow({ track, busy, numbered = false, hideAlbum = false, onPlay }: TrackRowProps) {
  return (
    <div
      className="avm-music-track"
      role="button"
      tabIndex={0}
      onClick={() => onPlay(track)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(track);
        }
      }}
    >
      {numbered ? (
        <span className="avm-music-track__num">{track.position ?? ""}</span>
      ) : (
        <span className="avm-music-cover avm-music-cover--small">
          <Music2 size={18} aria-hidden="true" />
          {track.cover_url && (
            <img
              src={track.cover_url}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </span>
      )}
      <span className="avm-music-track__main">
        <span className="avm-music-track__title">{track.title}</span>
        <span className="avm-music-track__sub" onClick={(e) => e.stopPropagation()}>
          {track.artist_id ? (
            <Link to={`/vaulttube/music/artist/${track.artist_id}`}>{track.artist}</Link>
          ) : (
            track.artist
          )}
          {!hideAlbum && track.album && (
            <>
              {" · "}
              {track.album_id ? (
                <Link to={`/vaulttube/music/album/${track.album_id}`}>{track.album}</Link>
              ) : (
                track.album
              )}
            </>
          )}
          {!hideAlbum && track.year ? ` · ${track.year}` : ""}
        </span>
      </span>
      <span className="avm-music-track__duration">{formatDuration(track.duration_ms)}</span>
      <span className="avm-music-track__play" aria-hidden="true">
        {busy ? <Loader2 size={16} className="avm-music-spin" /> : <Play size={16} />}
      </span>
    </div>
  );
}
