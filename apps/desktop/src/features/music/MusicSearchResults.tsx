import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mic2 } from "lucide-react";
import { AlbumCard } from "./AlbumCard";
import { TrackRow } from "./TrackRow";
import { errorMessage, musicApi, type MusicSearchKind, type MusicSearchResponse } from "./api";
import { usePlayTrack } from "./usePlayTrack";

interface MusicSearchResultsProps {
  query: string;
  kind: MusicSearchKind;
}

/** Résultats du catalogue musical pour un type donné (titres, albums, artistes). */
export function MusicSearchResults({ query, kind }: MusicSearchResultsProps) {
  const [data, setData] = useState<MusicSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { play, busyId, error: playError } = usePlayTrack();

  useEffect(() => {
    if (!query) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    musicApi
      .search(kind, query)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, "Recherche impossible."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, kind]);

  if (!query) {
    return (
      <div className="afy-empty">
        <div className="afy-empty__title">Saisissez un artiste, un album ou un titre.</div>
      </div>
    );
  }
  if (loading) return <div className="afy-loader">Recherche dans le catalogue…</div>;
  if (error) {
    return (
      <div className="afy-empty">
        <div className="afy-empty__title">{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const empty = data.tracks.length + data.albums.length + data.artists.length === 0;
  if (empty) {
    return (
      <div className="afy-empty">
        <div className="afy-empty__title">Aucun résultat pour « {query} ».</div>
        <p className="avm-music-hint">
          Essayez « Artiste - Titre », sans faute de frappe, ou l'onglet Vidéos.
        </p>
      </div>
    );
  }

  return (
    <div className="avm-music-results">
      {playError && <div className="avm-music-error">{playError}</div>}

      {kind === "track" && (
        <div className="avm-music-tracks">
          {data.tracks.map((track) => (
            <TrackRow key={track.id} track={track} busy={busyId === track.id} onPlay={play} />
          ))}
        </div>
      )}

      {kind === "album" && (
        <div className="avm-music-grid">
          {data.albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      )}

      {kind === "artist" && (
        <div className="avm-music-artists">
          {data.artists.map((artist) => {
            const details = [artist.kind === "Group" ? "Groupe" : artist.kind === "Person" ? "Artiste" : "", artist.country, artist.active_years]
              .filter(Boolean)
              .join(" · ");
            return (
              <Link key={artist.id} className="avm-music-artist" to={`/aetherfy/music/artist/${artist.id}`}>
                <span className="avm-music-avatar" aria-hidden="true">
                  {artist.name.trim().charAt(0).toUpperCase() || <Mic2 size={18} />}
                </span>
                <span className="avm-music-track__main">
                  <span className="avm-music-track__title">{artist.name}</span>
                  <span className="avm-music-track__sub">
                    {[artist.disambiguation, details].filter(Boolean).join(" — ")}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
