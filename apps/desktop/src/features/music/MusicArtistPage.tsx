import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AlbumCard } from "./AlbumCard";
import { errorMessage, musicApi, type MusicAlbum } from "./api";
import { useGoBack } from "../../hooks/useGoBack";
import "./music.css";

const SECTIONS: { kind: string; label: string }[] = [
  { kind: "album", label: "Albums" },
  { kind: "ep", label: "EP" },
  { kind: "single", label: "Singles" },
];

/** Fiche artiste : discographie (albums, EP, singles) classée du plus récent au plus ancien. */
export function MusicArtistPage() {
  const { artistId = "" } = useParams();
  const goBack = useGoBack("/vaulttube/music");
  const [albums, setAlbums] = useState<MusicAlbum[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAlbums(null);
    setError(null);
    musicApi
      .artistAlbums(artistId)
      .then((list) => {
        if (!cancelled) setAlbums(list);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, "Discographie indisponible."));
      });
    return () => {
      cancelled = true;
    };
  }, [artistId]);

  const artistName = albums?.find((a) => a.artist)?.artist ?? "Artiste";

  return (
    <div className="avm-music-page">
      <button type="button" className="avm-music-back" onClick={goBack}>
        <ArrowLeft size={16} aria-hidden="true" /> Retour
      </button>
      <h1 className="avm-music-page__title">{artistName}</h1>

      {!albums && !error && <div className="avm-music-empty">Chargement de la discographie…</div>}
      {error && (
        <div className="avm-music-empty">
          <div className="avm-music-empty__title">{error}</div>
        </div>
      )}
      {albums && albums.length === 0 && (
        <div className="avm-music-empty">
          <div className="avm-music-empty__title">Aucun disque référencé pour cet artiste.</div>
        </div>
      )}
      {albums &&
        SECTIONS.map(({ kind, label }) => {
          const list = albums.filter((a) => a.kind === kind);
          if (list.length === 0) return null;
          return (
            <section key={kind} className="avm-music-section">
              <h2 className="avm-music-section__title">{label}</h2>
              <div className="avm-music-grid">
                {list.map((album) => (
                  <AlbumCard key={album.id} album={album} showArtist={false} />
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
