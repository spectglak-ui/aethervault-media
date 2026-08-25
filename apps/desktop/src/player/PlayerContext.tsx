import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type {
  PlayableMedia,
  PlaybackQueueState,
  PlayerSettingsChangedPayload,
  PlayerStateEvent,
} from "@aethervault/shared-types";
import { playerApi } from "../features/player/api";
import { windowApi } from "../features/window/api";
import { playerSettingsApi } from "../features/playerSettings/api";
import { getWindowLabel } from "../window/getWindowLabel";

interface PlayerContextValue {
  currentMedia: PlayableMedia | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  rate: number;
  /**
   * ⚠️ Simplification (retour d'usage — le mode "étendu" CSS sans plein
   * écran natif apportait peu de valeur, remplacé par un vrai plein écran
   * façon YouTube/VLC/Jellyfin/Plex) : `isFullscreen` reflète
   * exclusivement l'état RÉEL de l'API Fullscreen du DOM sur le conteneur
   * du lecteur (`document.fullscreenElement === target`, voir l'effet
   * séparé plus bas qui est l'unique responsable de sa valeur). Il n'existe
   * plus de mode intermédiaire "agrandi mais pas plein écran" : soit le
   * lecteur est dans sa taille normale, soit il est en plein écran natif.
   * Indépendant de `isDetached` : un lecteur détaché occupe toujours
   * l'intégralité de sa propre fenêtre.
   */
  isFullscreen: boolean;
  /**
   * ⚠️ Correctif (étirement de l'image en plein écran) : la surface vidéo
   * (`<canvas>`, voir `PlayerSurface`) a toujours une résolution de dessin
   * qui correspond exactement à la vidéo source — l'étirement ne vient
   * jamais du pipeline de décodage/rendu, seulement de la façon dont ce
   * contenu est ensuite mis à l'échelle dans la mise en page CSS. Ce mode
   * pilote uniquement cette mise à l'échelle (propriété CSS `object-fit`
   * du canvas) :
   * - `"contain"` ("Ajuster", par défaut) : conserve le ratio, ajoute des
   *   bandes noires si besoin — jamais de déformation.
   * - `"cover"` ("Remplir") : conserve le ratio, recadre l'excédent.
   * - `"stretch"` ("Étirer") : déforme pour remplir tout l'espace —
   *   l'ancien comportement, désormais un choix explicite plutôt qu'un
   *   défaut subi.
   * - `"original"` ("Taille originale") : aucune mise à l'échelle, un
   *   pixel vidéo = un pixel écran.
   */
  displayMode: "contain" | "cover" | "stretch" | "original";
  setDisplayMode: (mode: "contain" | "cover" | "stretch" | "original") => void;
  /** Affichage déporté dans la seconde fenêtre Tauri ("player") plutôt que
   * dans la fenêtre principale — voir `commands::window` côté Rust.
   * Jamais un lecteur externe : même moteur, même état, juste une autre
   * fenêtre AetherVault (contrainte validée avant l'Étape 3b). */
  isDetached: boolean;
  /** `true` s'il existe un média après `currentMedia` dans la file de
   * lecture — commande l'état activé/désactivé du bouton "Piste
   * suivante". */
  hasNext: boolean;
  /** `true` s'il existe un média avant `currentMedia` dans la file de
   * lecture — commande l'état activé/désactivé du bouton "Piste
   * précédente". Ne préjuge pas du comportement au clic, voir
   * `playPrevious`. */
  hasPrevious: boolean;
  /** Message de la dernière erreur de lecture réelle (échec de
   * chargement/décodage — `mpv_event_end_file.reason == ERROR`, jamais
   * une fin de lecture normale). `null` tant qu'aucune erreur, remis à
   * `null` dès qu'un chargement démarre avec succès ou via `dismissError`. */
  lastError: string | null;
  dismissError: () => void;

  /** Lit un unique média, hors de toute file (équivaut à
   * `playQueue([media], 0)`) — conservé pour les appelants qui n'ont pas
   * de notion de liste. */
  play: (media: PlayableMedia) => void;
  /**
   * Remplace la file de lecture et démarre `items[startIndex]`.
   * Volontairement générique : `items` est une simple liste ordonnée de
   * `PlayableMedia`, sans aucune notion de bibliothèque, dossier ou
   * playlist — c'est à l'appelant (page bibliothèque aujourd'hui, future
   * page playlist/série/recherche demain) de construire cette liste dans
   * l'ordre qu'il souhaite. Voir la documentation technique, §4.2 bis.
   */
  playQueue: (items: PlayableMedia[], startIndex: number) => void;
  /** Passe au média suivant de la file ; no-op si `hasNext` est faux. */
  playNext: () => void;
  /**
   * Comportement VLC : si la lecture du média courant a commencé depuis
   * moins de `PREVIOUS_RESTART_THRESHOLD_SECONDS`, recule dans la file ;
   * sinon (ou s'il n'y a pas de média précédent) redémarre le média
   * courant depuis le début.
   */
  playPrevious: () => void;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  setVolumeLevel: (value: number) => void;
  toggleMuted: () => void;
  setRate: (value: number) => void;
  toggleFullscreen: () => void;
  toggleDetached: () => void;
  stop: () => void;
  captureScreenshot: () => Promise<string | null>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PROGRESS_SAVE_INTERVAL_MS = 5000;
const MIN_RESUMABLE_SECONDS = 5;
/** Seuil (en secondes de lecture écoulées) en-deçà duquel "Piste
 * précédente" recule réellement dans la file plutôt que de redémarrer le
 * média courant — convention VLC/MPC-HC. */
const PREVIOUS_RESTART_THRESHOLD_SECONDS = 3;

const EMPTY_QUEUE: PlaybackQueueState = { items: [], currentIndex: null };

/**
 * Id DOM du conteneur à mettre en plein écran natif (voir `toggleFullscreen`
 * ci-dessous) — posé par `PlayerDock` sur son conteneur `.avm-player`.
 * Ciblé par id plutôt que par ref React : ce fichier ne rend aucun DOM
 * lui-même (contexte pur), l'élément à mettre en plein écran est rendu par
 * `PlayerDock`, dans la fenêtre principale uniquement (jamais dans la
 * fenêtre détachée, qui n'expose pas le bouton concerné).
 */
export const FULLSCREEN_TARGET_ID = "avm-player-fullscreen-root";

/**
 * Diffuse la nouvelle file de lecture (source de vérité unique, voir la
 * documentation de `PlayerProvider` ci-dessous) puis déclenche le
 * chargement effectif dans le moteur, avec reprise de progression si
 * disponible. Factorisé une seule fois (Étape 3e) : avant l'introduction
 * de la file, cette séquence "récupérer la progression → charger →
 * reprendre" n'existait que dans `play` ; sans cette factorisation,
 * `playNext`/`playPrevious` l'auraient dupliquée deux fois de plus.
 *
 * Fonction de module plutôt que méthode de composant : elle n'a besoin
 * d'aucune closure sur le state React (seulement `items`/`index`
 * explicites), ce qui la rend appelable aussi bien depuis les actions
 * exposées par le contexte (recréées à chaque rendu) que depuis
 * l'écouteur `player-state` monté une seule fois (enchaînement
 * automatique en fin de fichier, voir plus bas).
 */
function loadAndBroadcast(items: PlayableMedia[], index: number): void {
  const media = items[index];
  void emit("player-queue-changed", { items, currentIndex: index } satisfies PlaybackQueueState);

  const getProgress = media.isPrivate ? playerApi.getPrivateProgress : playerApi.getProgress;

  getProgress(media.id)
    .then((progress) => {
      void playerApi.load(media.path).then(() => {
        if (progress && progress.position_seconds > MIN_RESUMABLE_SECONDS) {
          void playerApi.seek(progress.position_seconds);
        }
      });
    })
    .catch(() => {
      void playerApi.load(media.path);
    });
}

/**
 * ⚠️ Correctif + simplification (plein écran) : le bouton "Agrandir"
 * ne faisait auparavant qu'appliquer une classe CSS
 * (`avm-player--expanded`), sans jamais quitter la zone de rendu du
 * navigateur (chrome de fenêtre et barre des tâches du système toujours
 * visibles, pas de prise en charge native de la touche Échap) — et ce
 * mode "étendu" coexistait, de façon ambiguë, avec un vrai plein écran
 * natif optionnel. Ce mode intermédiaire est supprimé : il n'existe plus
 * qu'un bouton "Plein écran" unique, qui appelle directement l'API
 * Fullscreen du DOM (`Element.requestFullscreen()` /
 * `document.exitFullscreen()`) — voir `toggleFullscreen`.
 *
 * ⚠️ Refonte ultérieure (suppression du mini-lecteur docké, doublon avec
 * le PiP) : la mise en page "Normal" (par défaut dès qu'un média est
 * chargé et non détaché) et "Plein écran" partagent désormais LA MÊME
 * classe CSS (`.avm-player`, voir `layout.css`, `PlayerDock`) — il n'y a
 * plus de classe `--fullscreen` séparée. `isFullscreen` ne pilote donc
 * plus aucun style : il ne sert plus qu'à savoir si l'API Fullscreen du
 * navigateur est réellement engagée (icône du bouton, appel
 * `requestFullscreen`/`exitFullscreen`), dérivé à 100 % de
 * `document.fullscreenElement` (voir l'effet séparé dans
 * `PlayerProvider`) — un seul état possible, jamais deux concepts qui
 * pourraient diverger.
 *
 * Best-effort : `requestFullscreen()` peut être refusé par le navigateur
 * (absence de geste utilisateur direct, plateforme sans support) — dans ce
 * cas rien ne se passe, sans erreur bloquante pour l'utilisateur.
 */
function syncFullscreen(shouldBeFullscreen: boolean): void {
  if (typeof document === "undefined") return;

  if (shouldBeFullscreen) {
    if (document.fullscreenElement) return;
    const target = document.getElementById(FULLSCREEN_TARGET_ID);
    target?.requestFullscreen().catch(() => {
      // Refus best-effort — voir le commentaire ci-dessus.
    });
    return;
  }

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {
      // idem
    });
  }
}

/**
 * État et actions du lecteur, découplés du moteur de rendu. Depuis
 * l'Étape 3b, le moteur réel est le Playback Engine Bridge natif
 * (`services::playback_engine` côté Rust, libmpv) : chaque action ci-bas
 * envoie une commande Tauri, et l'état revient par l'événement
 * `player-state`. `PlayerControls` (Étape 3e, ex-duplication
 * `PlayerDock`/`DetachedPlayerWindow`) ne fait plus que de l'affichage —
 * il ne parle jamais directement au moteur.
 *
 * Chaque fenêtre Tauri exécute sa PROPRE instance de ce contexte (deux
 * webviews = deux runtimes JS distincts) : la file de lecture (donc
 * `currentMedia`, qui en est dérivé), volume/muet/vitesse et
 * `player-window-closed` sont donc synchronisés entre fenêtres via des
 * événements Tauri diffusés globalement (`emit`/`listen`, sans cible
 * précise) — c'est ce qui garantit que la fenêtre détachée affiche
 * vraiment "le même lecteur", pas une instance indépendante qui aurait sa
 * propre idée de l'état.
 *
 * Depuis l'Étape 3e, `currentMedia` n'est plus un état stocké séparément :
 * il est DÉRIVÉ de la file de lecture (`queue.items[queue.currentIndex]`),
 * elle-même seule source de vérité, diffusée par un unique événement
 * `player-queue-changed` (remplace l'ancien `player-media-changed`, dont
 * le payload plus étroit — un simple `PlayableMedia | null` — ne pouvait
 * pas porter la position dans la file). Sans cette unification, ajouter
 * une file de lecture aurait signifié synchroniser DEUX événements (média
 * + position dans la file) à chaque point d'entrée de lecture, avec le
 * risque qu'un des deux soit oublié ou arrive dans le désordre —
 * exactement la classe de bug déjà rencontrée et corrigée à l'Étape 3b
 * (cf. le commentaire dans l'effet ci-dessous). Une seule source de
 * vérité rend cette classe de bug impossible par construction plutôt que
 * de compter sur la discipline des futurs appelants.
 *
 * Cette Queue ne connaît ni bibliothèque, ni dossier, ni playlist — voir
 * `PlaybackQueueState` dans `shared-types` pour la distinction avec la
 * future Playlist persistée.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PlaybackQueueState>(EMPTY_QUEUE);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRateState] = useState(1);

  /**
   * ⚠️ Correctif (persistance — volume/muet/vitesse jamais retrouvés au
   * redémarrage) : chargement unique au montage. N'envoie PAS ces valeurs
   * à mpv ici volontairement — `playerApi.setVolume`/etc. n'ont de sens
   * qu'une fois un média chargé (voir `set_property_double`/`_flag` côté
   * Rust) ; ici on ne fait que préremplir l'état React, exactement comme
   * si l'utilisateur avait déjà réglé volume/muet/vitesse avant de
   * charger quoi que ce soit. Le prochain appel réel à `playerApi.load`
   * (dans `loadAndBroadcast`) laissera mpv démarrer avec ses propres
   * valeurs par défaut puis nos actions existantes (`setVolumeLevel`,
   * etc.) les appliqueront normalement à l'usage — aucun changement du
   * moteur ici, uniquement de l'état d'interface restauré à l'avance.
   */
  useEffect(() => {
    playerSettingsApi
      .get()
      .then((saved) => {
        if (!saved) return;
        setVolume(saved.volume);
        setMuted(saved.muted);
        setRateState(saved.rate);
        // Les propriétés mpv volume/muet/vitesse sont globales et restent
        // en l'état d'un chargement de fichier à l'autre (comportement
        // déjà existant, inchangé) — les appliquer une fois ici, au
        // démarrage, suffit à ce qu'elles soient effectives dès la
        // première vidéo lancée, pas seulement affichées dans
        // l'interface. Appels à des commandes déjà existantes et non
        // modifiées (mêmes que celles utilisées par les curseurs de
        // l'interface) — aucun changement du moteur.
        void playerApi.setVolume(saved.volume);
        void playerApi.setMuted(saved.muted);
        void playerApi.setRate(saved.rate);
      })
      .catch(() => {
        // Best-effort : pas de réglages sauvegardés, ou base
        // indisponible — les valeurs par défaut restent en place.
      });
  }, []);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Correctif (étirement de l'image) : "contain" par défaut — voir la
  // documentation du champ dans PlayerContextValue plus haut. Non
  // persisté d'une session à l'autre (contrairement à volume/muet/
  // vitesse) : ce n'était pas demandé, et "Ajuster" par défaut à chaque
  // démarrage est un choix sûr en soi.
  const [displayMode, setDisplayMode] = useState<
    "contain" | "cover" | "stretch" | "original"
  >("contain");
  // ⚠️ Correctif (bouton "Redocker" sans effet depuis la fenêtre PiP) :
  // `isDetached` valait auparavant toujours `false` à l'initialisation,
  // y compris dans la fenêtre PiP elle-même — son propre `toggleDetached`
  // prenait donc la branche "ouverture" au lieu de "fermeture" en cliquant
  // sur "Redocker", puisqu'elle ignorait être elle-même la fenêtre
  // détachée. Plutôt que de dépendre d'un rejeu d'état (sujet à la même
  // classe de course que `currentMedia`, voir plus bas), chaque fenêtre
  // déduit `isDetached` de sa propre identité, connue dès le premier
  // rendu, sans aucun aller-retour réseau : la fenêtre "player" EST la
  // fenêtre détachée, par construction.
  const [isDetached, setIsDetached] = useState(() => getWindowLabel() === "player");
  // Correctif (retour utilisateur après livraison — "MKV fonctionne, pas
  // MP4") : le backend distingue désormais une fin de lecture normale
  // d'un véritable échec (voir services::playback_engine côté Rust) et
  // renseigne `error` dans ce second cas. Affiché par `PlayerControls`.
  const [lastError, setLastError] = useState<string | null>(null);

  const currentMedia =
    queue.currentIndex !== null ? queue.items[queue.currentIndex] ?? null : null;

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const currentMediaRef = useRef<PlayableMedia | null>(null);
  currentMediaRef.current = currentMedia;
  const positionRef = useRef(0);
  positionRef.current = position;
  const durationRef = useRef(0);
  durationRef.current = duration;

  /**
   * ⚠️ Correctif (gel/plantage au clic sur un curseur) : `Slider` (ui-kit)
   * enveloppe un `<input type="range">` natif — son `onChange` React est
   * branché sur l'événement DOM `input`, qui se déclenche en continu
   * pendant le glissement (des dizaines de fois par seconde), pas
   * seulement à la fin du geste. `seek()` envoie une VRAIE commande de
   * recherche à mpv à chaque appel, et `setVolumeLevel()` déclenche
   * désormais aussi une écriture SQLite (persistance) — glisser un
   * curseur revenait donc à bombarder mpv et la base de dizaines
   * d'appels par seconde.
   *
   * Correctif : la valeur affichée (position/volume) reste mise à jour
   * instantanément à chaque tick, pour un retour visuel fluide — seul
   * l'appel réel vers mpv/la base est temporisé (150 ms d'inactivité).
   * Aucune commande mpv supplémentaire envoyée pendant le glissement, une
   * seule à la fin — comportement standard pour ce type de contrôle.
   */
  const seekDebounceRef = useRef<number | null>(null);
  const volumeDebounceRef = useRef<number | null>(null);

  // Écoute des événements diffusés par le backend (position/durée/pause,
  // seule source de vérité pour ces trois-là — c'est mpv qui les mesure)
  // et des événements frontend-à-frontend qui gardent les deux fenêtres
  // synchronisées pour tout ce que mpv ne connaît pas (file de lecture,
  // réglages, fermeture de la fenêtre détachée).
  useEffect(() => {
    const unlistenState = listen<PlayerStateEvent>("player-state", (event) => {
      const { position_seconds, duration_seconds, playing, ended, error } = event.payload;
      if (position_seconds !== undefined && position_seconds !== null) {
        setPosition(position_seconds);
      }
      if (duration_seconds !== undefined && duration_seconds !== null) {
        setDuration(duration_seconds);
      }
      if (playing !== undefined && playing !== null) {
        setIsPlaying(playing);
      }
      if (error) {
        setLastError(`Lecture impossible : ${error}`);
      }

      // Enchaînement automatique (Étape 3e) : uniquement sur fin naturelle
      // du fichier (mpv `END_FILE`), jamais sur un `stop()` explicite —
      // celui-ci vide déjà la file avant qu'`ended` ne puisse être
      // observé. Pas de répétition ni de boucle : la lecture s'arrête
      // simplement si la file est terminée.
      if (ended) {
        const { items, currentIndex } = queueRef.current;
        if (currentIndex !== null && currentIndex < items.length - 1) {
          loadAndBroadcast(items, currentIndex + 1);
        }
      }
    });

    // ⚠️ Correctif (retour de diagnostic — "3 surfaces natives créées pour
    // un seul `play()`") : `emit()` diffuse aussi vers la fenêtre qui
    // l'appelle elle-même (pas seulement vers les autres fenêtres). Ce
    // `listen` est le SEUL endroit qui applique l'état dérivé d'un
    // changement de média (`isPlaying`/remise à zéro de la
    // position et de la durée) : les actions (`playQueue`, `playNext`,
    // `playPrevious`, `stop`...) ne les modifient jamais directement,
    // elles se contentent d'émettre `player-queue-changed` et laissent CE
    // listener (qui reçoit aussi son propre `emit`) appliquer l'état une
    // seule fois, de façon identique pour la fenêtre d'origine et pour les
    // autres.
    let lastMediaId: number | null = null;
    const unlistenQueue = listen<PlaybackQueueState>("player-queue-changed", (event) => {
      const state = event.payload;
      const media =
        state.currentIndex !== null ? state.items[state.currentIndex] ?? null : null;
      const mediaChanged = (media?.id ?? null) !== lastMediaId;
      lastMediaId = media?.id ?? null;

      setQueue(state);
      if (mediaChanged) {
        setIsPlaying(media !== null);
        setPosition(0);
        setDuration(0);
        // Correctif (plein écran) : fermer le lecteur (`stop()`, media
        // devient `null`) doit aussi quitter un éventuel plein écran natif
        // en cours — sans quoi l'écran resterait bloqué en plein écran sur
        // un lecteur qui vient de disparaître. `syncFullscreen` est
        // best-effort et ne fait rien si aucun plein écran n'est actif.
        //
        // ⚠️ Simplification : il n'y a plus d'auto-agrandissement au
        // démarrage d'un média (l'ancien `setIsExpanded(media !== null)`
        // est supprimé) — le lecteur démarre toujours en taille normale,
        // le plein écran est désormais une action exclusivement
        // volontaire (bouton dédié, voir `toggleFullscreen`).
        if (media === null) {
          syncFullscreen(false);
        }
      }
      // Tout `player-queue-changed` correspond à un chargement qui vient
      // de démarrer (`loadAndBroadcast` l'émet juste avant `playerApi.load`)
      // — y compris rejouer le même fichier après un échec, jamais capturé
      // par `mediaChanged` (identifiant inchangé). Efface donc ici plutôt
      // que dans `unlistenState`, qui n'a pas cette garantie.
      setLastError(null);
    });

    const unlistenSettings = listen<PlayerSettingsChangedPayload>(
      "player-settings-changed",
      (event) => {
        setVolume(event.payload.volume);
        setMuted(event.payload.muted);
        setRateState(event.payload.rate);
      }
    );

    // Fermeture de la fenêtre détachée via la croix du système (pas via
    // `toggleDetached`) : émis uniquement vers "main" par
    // `commands::window::open_player_window` côté Rust.
    const unlistenClosed = listen("player-window-closed", () => {
      setIsDetached(false);
    });

    return () => {
      void unlistenState.then((fn) => fn());
      void unlistenQueue.then((fn) => fn());
      void unlistenSettings.then((fn) => fn());
      void unlistenClosed.then((fn) => fn());
    };
  }, []);

  // ⚠️ Correctif + simplification (plein écran, prise en charge native de
  // la touche Échap) : le navigateur quitte lui-même le plein écran sur
  // Échap — rien à faire côté clavier. Cet effet est l'UNIQUE responsable
  // de la valeur d'`isFullscreen` (aucune autre action ne l'écrit
  // directement) : il se contente de refléter l'état réel de l'API
  // Fullscreen sur notre conteneur, que la sortie passe par le bouton
  // (`toggleFullscreen`), par Échap, ou par tout autre mécanisme natif.
  // Plus besoin de distinguer "notre cible" via une référence (comme
  // avant, quand l'ancien `isExpanded` pouvait aussi valoir `true` sans plein
  // écran réel engagé) : il n'existe plus qu'un seul état possible,
  // directement comparable à `document.fullscreenElement`.
  useEffect(() => {
    const handleFullscreenChange = () => {
      const target = document.getElementById(FULLSCREEN_TARGET_ID);
      setIsFullscreen(document.fullscreenElement === target);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const saveProgressNow = () => {
    const media = currentMediaRef.current;
    if (media && durationRef.current > 0) {
      const saveProgress = media.isPrivate ? playerApi.savePrivateProgress : playerApi.saveProgress;
      saveProgress(media.id, positionRef.current, durationRef.current).catch(() => {
        // La progression est un confort, pas une donnée critique.
      });
    }
  };

  useEffect(() => {
    if (!currentMedia || !isPlaying) return;
    const interval = window.setInterval(saveProgressNow, PROGRESS_SAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [currentMedia, isPlaying]);

  const hasNext = queue.currentIndex !== null && queue.currentIndex < queue.items.length - 1;
  const hasPrevious = queue.currentIndex !== null && queue.currentIndex > 0;

  const value = useMemo<PlayerContextValue>(
    () => ({
      currentMedia,
      isPlaying,
      position,
      duration,
      volume,
      muted,
      rate,
      isFullscreen,
      displayMode,
      setDisplayMode,
      isDetached,

      play: (media) => loadAndBroadcast([media], 0),

      playQueue: (items, startIndex) => {
        if (items.length === 0) return;
        const clampedIndex = Math.min(Math.max(startIndex, 0), items.length - 1);
        loadAndBroadcast(items, clampedIndex);
      },

      playNext: () => {
        const { items, currentIndex } = queueRef.current;
        if (currentIndex === null || currentIndex >= items.length - 1) return;
        loadAndBroadcast(items, currentIndex + 1);
      },

      playPrevious: () => {
        const { items, currentIndex } = queueRef.current;
        if (currentIndex === null) return;
        if (positionRef.current > PREVIOUS_RESTART_THRESHOLD_SECONDS || currentIndex === 0) {
          setPosition(0);
          void playerApi.seek(0);
          return;
        }
        loadAndBroadcast(items, currentIndex - 1);
      },

      togglePlay: () => {
        const next = !isPlaying;
        setIsPlaying(next);
        void playerApi.setPaused(!next);
      },

      seek: (seconds) => {
        setPosition(seconds);
        if (seekDebounceRef.current !== null) {
          window.clearTimeout(seekDebounceRef.current);
        }
        seekDebounceRef.current = window.setTimeout(() => {
          void playerApi.seek(seconds);
        }, 150);
      },

      setVolumeLevel: (level) => {
        setVolume(level);
        if (volumeDebounceRef.current !== null) {
          window.clearTimeout(volumeDebounceRef.current);
        }
        volumeDebounceRef.current = window.setTimeout(() => {
          void playerApi.setVolume(level);
          const next = { volume: level, muted, rate };
          void emit("player-settings-changed", next);
          void playerSettingsApi.save(next);
        }, 150);
      },

      toggleMuted: () => {
        const muteNext = !muted;
        setMuted(muteNext);
        void playerApi.setMuted(muteNext);
        const next = { volume, muted: muteNext, rate };
        void emit("player-settings-changed", next);
        void playerSettingsApi.save(next);
      },

      setRate: (value) => {
        setRateState(value);
        void playerApi.setRate(value);
        const next = { volume, muted, rate: value };
        void emit("player-settings-changed", next);
        void playerSettingsApi.save(next);
      },

      // Appelé directement depuis le clic du bouton "Plein écran" (jamais
      // depuis un effet réagissant à un changement d'état) : les
      // navigateurs (et WebView2) n'autorisent `requestFullscreen()` que
      // depuis un geste utilisateur direct — voir `syncFullscreen`.
      // Ne met plus `isFullscreen` à jour directement : c'est l'effet
      // `fullscreenchange` ci-dessus qui le fait, dans les deux sens
      // (entrée ET sortie) — source de vérité unique, jamais de risque de
      // divergence entre l'état React et l'état réel du navigateur.
      toggleFullscreen: () => syncFullscreen(!isFullscreen),

      /**
       * ⚠️ Correctif (clic PiP sans effet, lecteur bloqué en permanence —
       * retour de test réel) : l'effet de bord (ouverture/fermeture de la
       * fenêtre "player") vivait auparavant À L'INTÉRIEUR de la fonction
       * passée à `setIsDetached(...)`. React (StrictMode, actif en
       * développement — voir `main.tsx`) invoque délibérément deux fois ce
       * genre de fonction pour détecter les effets de bord : l'ouverture de
       * fenêtre partait donc deux fois par clic, sans aucune protection
       * contre la séquence vérifier-puis-créer non atomique côté Rust (voir
       * `commands::window`). `isDetached` passait en plus à `true` de façon
       * optimiste, sans jamais attendre de confirmation — un échec de
       * `open_player_window` (silencieux, `void ...` sans `.catch()`)
       * laissait alors `isDetached` bloqué à `true` indéfiniment, avec
       * `PlayerDock` qui n'affiche plus rien dans cet état (voir la refonte
       * précédente) : plus aucun lecteur visible nulle part.
       *
       * Corrigé : effet de bord sorti du `setState` ; `isDetached` n'est
       * mis à jour qu'APRÈS confirmation explicite du succès de la
       * commande, dans les deux sens (ouverture ET fermeture, par
       * cohérence) ; tout échec est capturé, journalisé en console, et
       * remonté via `lastError` (bandeau déjà existant dans
       * `PlayerControls`) plutôt que silencieusement avalé.
       */
      toggleDetached: () => {
        if (isDetached) {
          console.info("[PiP] Fermeture demandée.");
          windowApi
            .closePlayerWindow()
            .then(() => {
              console.info("[PiP] Fenêtre fermée avec succès.");
              setIsDetached(false);
            })
            .catch((err) => {
              console.error("[PiP] Échec de la fermeture de la fenêtre PiP.", err);
              setLastError("Impossible de fermer la fenêtre Picture-in-Picture.");
              // La fenêtre pourrait malgré tout être encore ouverte : ne
              // pas remettre isDetached à false sur un échec, pour ne pas
              // afficher à tort le lecteur principal en double.
            });
          return;
        }

        console.info("[PiP] Ouverture demandée.");
        windowApi
          .openPlayerWindow()
          .then(() => {
            console.info("[PiP] Fenêtre ouverte avec succès.");
            setIsDetached(true);
          })
          .catch((err) => {
            console.error("[PiP] Échec de l'ouverture de la fenêtre PiP.", err);
            setLastError("Impossible d'ouvrir le mode Picture-in-Picture. Réessayez.");
            // isDetached reste `false` : le lecteur principal reste
            // affiché, plus jamais d'état "aucun lecteur visible nulle
            // part" comme avant ce correctif.
          });
      },

      stop: () => {
        void playerApi.stop();
        windowApi
          .closePlayerWindow()
          .catch((err) => console.error("[PiP] Échec de la fermeture (stop()).", err));
        setIsDetached(false);
        void emit("player-queue-changed", EMPTY_QUEUE satisfies PlaybackQueueState);
      },

      captureScreenshot: () =>
        playerApi.captureScreenshot().catch(() => null),
    }),
    [
      currentMedia,
      isPlaying,
      position,
      duration,
      volume,
      muted,
      rate,
      isFullscreen,
      displayMode,
      isDetached,
      hasNext,
      hasPrevious,
      lastError,
    ]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayer doit être utilisé à l'intérieur de <PlayerProvider>");
  }
  return ctx;
}
