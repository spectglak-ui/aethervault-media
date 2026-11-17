import { Link } from "react-router-dom";
import { Disc3 } from "lucide-react";
import { ALBUM_KIND_LABELS, type MusicAlbum } from "./api";

/** Carte d'album (pochette, titre, artiste · année) vers la page de l'album. */
export function AlbumCard({ album, showArtist = true }: { album: MusicAlbum; showArtist?: boolean }) {
  const kind = ALBUM_KIND_LABELS[album.kind] ?? "";
  const extra = album.secondary_types.length > 0 ? album.secondary_types.join(", ") : "";
  const details = [showArtist ? album.artist : "", album.year ? String(album.year) : "", kind, extra]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link className="avm-music-album" to={`/vaulttube/music/album/${album.id}`}>
      <span className="avm-music-cover avm-music-cover--large">
        <Disc3 size={32} aria-hidden="true" />
        <img
          src={album.cover_url}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </span>
      <span className="avm-music-album__title">{album.title}</span>
      <span className="avm-music-album__sub">{details}</span>
    </Link>
  );
}
