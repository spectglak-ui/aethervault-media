import { useState } from "react";
import { ImageUp, RotateCcw } from "lucide-react";
import { IconButton } from "@aethervault/ui-kit";
import { categoryApi } from "../category/api";
import "./personalization.css";

interface PersonalizableImageProps {
  /** URL déjà résolue (voir `lib/assetUrl.ts`), ou `undefined` — le
   * composant affiche alors un espace réservé plutôt qu'une image cassée. */
  src?: string;
  alt: string;
  /** Détermine uniquement la classe CSS appliquée (ratio, taille). */
  variant: "poster" | "banner";
  /** `true` si `src` provient d'une personnalisation utilisateur — commande
   * l'affichage du bouton "Réinitialiser" : il n'a pas de sens face à une
   * image déjà automatique (rien à réinitialiser). */
  isCustom: boolean;
  /** Appelé avec le chemin absolu choisi par l'utilisateur, une fois le
   * sélecteur de fichier natif confirmé — à charge du parent de le
   * persister via la commande propre à son entité (`categoryApi.setBanner`,
   * `titleApi.setPoster`...). Ce composant ne connaît volontairement
   * aucune de ces entités : c'est ce qui le rend réutilisable tel quel
   * pour toute future personnalisation (doc §6.6 : "préparer une
   * architecture facilement extensible"). */
  onPick: (sourcePath: string) => Promise<void>;
  onReset: () => Promise<void>;
}

/**
 * Personnalisation d'une image (affiche ou bannière) — doc §6.6. Toute la
 * logique d'interaction (ouvrir le sélecteur, distinguer personnalisé vs.
 * automatique, proposer la réinitialisation) vit ici une seule fois ;
 * chaque appelant ne fournit que "quoi faire du chemin choisi" et "quoi
 * faire pour réinitialiser" — deux fonctions, aucune connaissance de
 * `custom_images` ni des commandes Tauri sous-jacentes. Ajouter la
 * personnalisation d'une future entité (bannière de bibliothèque privée,
 * avatar de profil...) n'importe pas plus que ce composant plus deux
 * fonctions d'un paragraphe chacune côté backend (voir
 * `custom_image_repository`).
 */
export function PersonalizableImage({
  src,
  alt,
  variant,
  isCustom,
  onPick,
  onReset,
}: PersonalizableImageProps) {
  const [busy, setBusy] = useState(false);

  const handlePick = async () => {
    const sourcePath = await categoryApi.pickImage();
    if (!sourcePath) return;

    setBusy(true);
    try {
      await onPick(sourcePath);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      await onReset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`avm-personalizable avm-personalizable--${variant}`}>
      {src ? (
        <img src={src} alt={alt} />
      ) : (
        <div className="avm-card__placeholder" aria-hidden="true" />
      )}

      <div className="avm-personalizable__actions">
        <IconButton label="Changer l'image" onClick={() => void handlePick()} disabled={busy}>
          <ImageUp size={16} />
        </IconButton>
        {isCustom && (
          <IconButton
            label="Réinitialiser l'image automatique"
            onClick={() => void handleReset()}
            disabled={busy}
          >
            <RotateCcw size={16} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
