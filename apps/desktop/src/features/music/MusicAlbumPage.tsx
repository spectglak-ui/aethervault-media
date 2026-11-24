import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Disc3, Play } from "lucide-react";
import { TrackRow } from "./TrackRow";
import { ALBUM_KIND_LABELS, errorMessage, musicApi, type MusicAlbumDetail } from "./api";
import { usePlayTrack } from "./usePlayTrack";
import { useGoBack } from "../../hooks/useGoBack";
import "./music.css";

/** Page d'un album : pochette, informations et liste des pistes. */
export function MusicAlbumPage() {
  const { albumId = "" } = useParams();
  const goBack = useGoBack("/vaulttube/music");
  const [detail, setDetail] = useState<MusicAlbumDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { play, busyId, error: playError } = usePlayTrack();

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(null);
    musicApi
      .albumTracks(albumId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, "Album indisponible."));
      });
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  const totalMs = detail?.tracks.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0) ?? 0;

  return (
    <div className="avm-music-page">
      <button type="button" className="avm-music-back" onClick={goBack}>
        <ArrowLeft size={16} aria-hidden="true" /> Retour
      </button>

      {detail === undefined && !error && <div className="avm-music-empty">Chargement de l'album…</div>}
      {error && (
        <div className="avm-music-empty">
          <div className="avm-music-empty__title">{error}</div>
        </div>
      )}
      {detail === null && (
        <div className="avm-music-empty">
          <div className="avm-music-empty__title">Le catalogue ne connaît pas la liste des pistes de cet album.</div>
        </div>
      )}

      {detail && (
        <>
          <header className="avm-music-album-head">
            <span className="avm-music-cover avm-music-cover--hero">
              <Disc3 size={48} aria-hidden="true" />
              <img
                src={detail.album.cover_url}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </span>
            <div>
              <div className="avm-music-hint">
                {ALBUM_KIND_LABELS[detail.album.kind] ?? "Album"}
                {detail.album.secondary_types.length > 0 ? ` · ${detail.album.secondary_types.join(", ")}` : ""}
              </div>
              <h1 className="avm-music-page__title">{detail.album.title}</h1>
              <div className="avm-music-hint">
                {detail.album.artist_id ? (
                  <Link to={`/vaulttube/music/artist/${detail.album.artist_id}`}>{detail.album.artist}</Link>
                ) : (
                  detail.album.artist
                )}
                {detail.album.year ? ` · ${detail.album.year}` : ""}
                {` · ${detail.tracks.length} titre${detail.tracks.length > 1 ? "s" : ""}`}
                {totalMs > 0 ? ` · ${Math.round(totalMs / 60000)} min` : ""}
              </div>
              {detail.tracks.length > 0 && (
                <button
                  type="button"
                  className="avm-music-playall"
                  disabled={busyId !== null}
                  onClick={() => void play(detail.tracks[0])}
                >
                  <Play size={16} aria-hidden="true" /> Écouter
                </button>
              )}
            </div>
          </header>

          {playError && <div className="avm-music-error">{playError}</div>}

          <div className="avm-music-tracks">
            {detail.tracks.map((track) => (
              <TrackRow
                key={`${track.position}-${track.id}`}
                track={track}
                busy={busyId === track.id}
                numbered
                hideAlbum
                onPlay={play}
              />
            ))}
          </div>
          {detail.tracks.length > 0 && (
            <p className="avm-music-hint">
              Un clic sur un titre cherche et lit sa version officielle (le choix est mémorisé).
            </p>
          )}
        </>
      )}
    </div>
  );
}
