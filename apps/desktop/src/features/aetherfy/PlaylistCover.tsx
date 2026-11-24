import { ListMusic } from "lucide-react";

/**
 * Image d'une playlist locale :
 *  1. l'image choisie par l'utilisateur ;
 *  2. sinon une mosaïque 2×2 des 4 premiers titres (une seule vignette s'il y en a moins de 4) ;
 *  3. sinon une icône.
 */
export function PlaylistCover({
  custom,
  previews,
}: {
  custom?: string | null;
  previews?: string[];
}) {
  const thumbs = (previews ?? []).filter(Boolean);
  if (custom) {
    return (
      <span className="avm-mh-cover">
        <img src={custom} alt="" draggable={false} />
      </span>
    );
  }
  if (thumbs.length >= 4) {
    return (
      <span className="avm-mh-cover avm-mh-cover--mosaic">
        {thumbs.slice(0, 4).map((src) => (
          <img key={src} src={src} alt="" loading="lazy" draggable={false} />
        ))}
      </span>
    );
  }
  if (thumbs.length >= 1) {
    return (
      <span className="avm-mh-cover">
        <img src={thumbs[0]} alt="" loading="lazy" draggable={false} />
      </span>
    );
  }
  return (
    <span className="avm-mh-cover avm-mh-cover--void">
      <ListMusic size={26} />
    </span>
  );
}
