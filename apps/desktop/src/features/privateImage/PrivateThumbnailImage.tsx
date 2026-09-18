import { useEffect, useState } from "react";

interface PrivateThumbnailImageProps {
  /** `privateImageApi.getThumbnail` ou `.getAlbumCover`, déjà lié à son
   * identifiant — ce composant ne connaît volontairement ni fichier ni
   * dossier, uniquement "comment obtenir une chaîne base64". */
  fetchThumbnail: () => Promise<string | null>;
  alt: string;
  className?: string;
}

/**
 * Charge une vignette chiffrée du coffre à la demande (doc §6.4 quater) et
 * l'affiche directement comme URI `data:image/jpeg;base64,...` — pas de
 * `Blob`/`URL.createObjectURL` à gérer ni à révoquer. Un espace réservé
 * neutre s'affiche pendant le chargement ou si aucune vignette n'existe
 * (fichier pas encore scanné, ou décodage ayant échoué côté serveur).
 */
export function PrivateThumbnailImage({ fetchThumbnail, alt, className }: PrivateThumbnailImageProps) {
  const [base64, setBase64] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchThumbnail().then((data) => {
      if (!cancelled) setBase64(data);
    });
    return () => {
      cancelled = true;
    };
    // Volontairement `[]` : `fetchThumbnail` change de référence à chaque
    // rendu du parent (fermeture recréée à chaque `.map()`), mais les
    // données qu'elle récupère ne dépendent que de l'identifiant utilisé
    // comme `key` par la liste appelante — un nouveau montage (donc un
    // nouvel appel) se produit déjà naturellement quand cette clé change.
    // Inclure `fetchThumbnail` ici provoquerait un rechargement inutile de
    // la vignette à chaque rendu du parent, même sans rapport avec elle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!base64) {
    return <div className={["avm-private-thumb avm-private-thumb--empty", className].filter(Boolean).join(" ")} />;
  }

  return (
    <img
      src={`data:image/jpeg;base64,${base64}`}
      alt={alt}
      className={["avm-private-thumb", className].filter(Boolean).join(" ")}
    />
  );
}
