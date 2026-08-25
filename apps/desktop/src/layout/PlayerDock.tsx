import { usePlayer, FULLSCREEN_TARGET_ID } from "../player/PlayerContext";
import { PlayerSurface } from "../player/PlayerSurface";
import { PlayerControls } from "../player/PlayerControls";
import { useControlsAutoHide } from "../player/useControlsAutoHide";

/**
 * Habillage du lecteur dans la fenêtre principale : emplacement de la
 * surface vidéo autour des contrôles partagés (`PlayerControls`, Étape
 * 3e). Depuis l'Étape 3b, ce composant ne parle plus du tout au moteur de
 * lecture — il affiche l'état de `usePlayer()` et délègue le rendu vidéo à
 * `PlayerSurface` et les commandes à `PlayerControls`.
 *
 * ⚠️ Refonte (retour d'usage — trois états désormais, plus de mini-lecteur
 * docké) : ancien historique — la suppression du mode Agrandir/Réduire
 * avait laissé la lecture démarrer directement dans un petit widget en
 * coin d'écran (340×190), qui n'a jamais été conçu pour être LA taille de
 * lecture normale, et dont la barre de contrôle ne pouvait de toute façon
 * pas contenir tous les boutons à cette largeur (contrôles coupés
 * silencieusement par `overflow: hidden`).
 *
 * Constat, en vérifiant l'utilité propre de ce widget face au PiP
 * (fenêtre Tauri séparée, `always_on_top`) : il faisait doublon, en moins
 * capable (disparaît si on change d'application, occupe de l'espace dans
 * la fenêtre principale) — aucune raison de le garder. Il n'existe donc
 * plus que trois états, sans mode intermédiaire :
 * 1. **Normal** (par défaut dès qu'un média est chargé et non détaché) :
 *    le lecteur recouvre la quasi-totalité de la fenêtre AetherVault —
 *    même mise en page que "Plein écran" (voir `layout.css`, plus de
 *    classe `--docked` séparée), à la différence près que l'API
 *    Fullscreen du navigateur n'est pas engagée.
 * 2. **PiP** (`isDetached`) : ce composant ne rend RIEN dans la fenêtre
 *    principale — l'affichage vit entièrement dans la fenêtre "player"
 *    (voir `DetachedPlayerWindow`), qui a désormais l'exclusivité de la
 *    lecture "en arrière-plan pendant qu'on navigue".
 * 3. **Plein écran** (`isFullscreen`) : mêmes styles que "Normal", plus
 *    l'API Fullscreen du DOM réellement engagée (voir `PlayerContext`,
 *    `toggleFullscreen`).
 *
 * `id={FULLSCREEN_TARGET_ID}` sur ce conteneur est la cible de
 * `Element.requestFullscreen()` appelé depuis `PlayerContext`.
 *
 * Masquage automatique des contrôles (voir `useControlsAutoHide`) :
 * actif dans les deux cas où ce composant affiche quelque chose (Normal
 * ET Plein écran partagent la même mise en page en incrustation) —
 * n'a plus besoin d'être conditionné à `isFullscreen` spécifiquement,
 * puisqu'il n'existe plus de mode "contrôles toujours en flux normal".
 */
export function PlayerDock() {
  const { currentMedia, isDetached, isPlaying } = usePlayer();
  const active = Boolean(currentMedia) && !isDetached;
  const { visible: controlsVisible, onActivity, controlsHoverHandlers } = useControlsAutoHide(
    active,
    isPlaying
  );

  // Le PiP a l'exclusivité de l'affichage pendant la lecture détachée —
  // rien à montrer dans la fenêtre principale (voir la note ci-dessus).
  if (!currentMedia || isDetached) {
    return null;
  }

  return (
    <div
      id={FULLSCREEN_TARGET_ID}
      className="avm-player"
      onMouseMove={onActivity}
    >
      <PlayerSurface className="avm-player__surface" />

      <div
        className={[
          "avm-player__controls-wrap",
          !controlsVisible ? "avm-player__controls-wrap--hidden" : "",
        ].join(" ")}
        {...controlsHoverHandlers}
      >
        <PlayerControls variant="normal" />
      </div>
    </div>
  );
}
