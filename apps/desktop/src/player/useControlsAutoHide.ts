import { useCallback, useEffect, useRef, useState } from "react";

/** Délai d'inactivité avant masquage — convention courante des lecteurs
 * vidéo grand public (YouTube, VLC, Jellyfin), ni trop court (masquage
 * agaçant pendant une hésitation de la souris) ni trop long (barre de
 * contrôle qui traîne inutilement sur l'image). */
const HIDE_DELAY_MS = 3000;

/**
 * Masquage automatique de la barre de contrôle du lecteur — correctif :
 * jusqu'ici, aucune logique de masquage n'existait, la barre restait
 * affichée en permanence, y compris en mode étendu/plein écran où elle
 * recouvre alors une partie de l'image en continu.
 *
 * Règles (toutes explicitement demandées) :
 * - apparition immédiate au moindre mouvement de souris (`onActivity`) ;
 * - disparition après `HIDE_DELAY_MS` d'inactivité ;
 * - toujours visible si la vidéo est en pause (`isPlaying` faux) ;
 * - toujours visible tant que la souris survole la barre elle-même
 *   (`controlsHoverHandlers`, à poser sur le conteneur des contrôles).
 *
 * `active` permet à l'appelant de désactiver entièrement le masquage
 * (ex. mode "docké" réduit, où les contrôles sont dans le flux normal de
 * la mise en page plutôt qu'en recouvrement de la vidéo — les masquer y
 * laisserait un vide plutôt que de révéler l'image, voir `PlayerDock`) :
 * les contrôles restent alors toujours visibles, sans minuteur.
 *
 * Volontairement un hook autonome, sans dépendance à `PlayerContext` : il
 * ne fait que dériver une visibilité d'affichage à partir d'événements DOM
 * locaux et de deux booléens fournis par l'appelant — aucun état de
 * lecture n'est dupliqué ici.
 */
export function useControlsAutoHide(active: boolean, isPlaying: boolean) {
  const [visible, setVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const hoveringControlsRef = useRef(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    // Ni en pause, ni si la souris est sur la barre elle-même, ni si le
    // masquage est désactivé pour ce mode d'affichage.
    if (!active || !isPlaying || hoveringControlsRef.current) return;
    hideTimerRef.current = window.setTimeout(() => setVisible(false), HIDE_DELAY_MS);
  }, [active, isPlaying, clearHideTimer]);

  /** À poser sur `onMouseMove` (et assimilés) de la zone du lecteur. */
  const onActivity = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  // Recalcule l'état visible/minuteur chaque fois que le mode ou l'état de
  // lecture change (ex. passage en pause → réapparition immédiate et
  // annulation du minuteur, sans attendre un mouvement de souris).
  useEffect(() => {
    if (!active || !isPlaying) {
      setVisible(true);
      clearHideTimer();
      return clearHideTimer;
    }
    scheduleHide();
    return clearHideTimer;
  }, [active, isPlaying, scheduleHide, clearHideTimer]);

  const onControlsMouseEnter = useCallback(() => {
    hoveringControlsRef.current = true;
    clearHideTimer();
    setVisible(true);
  }, [clearHideTimer]);

  const onControlsMouseLeave = useCallback(() => {
    hoveringControlsRef.current = false;
    scheduleHide();
  }, [scheduleHide]);

  return {
    /** `true` : la barre de contrôle doit être affichée. */
    visible,
    /** À poser sur `onMouseMove` du conteneur englobant (vidéo + contrôles). */
    onActivity,
    /** À poser sur la barre de contrôle elle-même. */
    controlsHoverHandlers: {
      onMouseEnter: onControlsMouseEnter,
      onMouseLeave: onControlsMouseLeave,
    },
  };
}
