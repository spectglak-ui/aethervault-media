/**
 * Miroir de `commands::playback::get_playback_progress`.
 */
export interface PlaybackProgress {
  media_file_id: number;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
}

/**
 * Média passé à `usePlayer().play(...)`. Volontairement minimal : tout ce
 * dont le lecteur a besoin pour démarrer, indépendamment du moteur
 * (HTML5 aujourd'hui, libmpv à l'Étape 3b).
 *
 * `isPrivate` (Étape 6b-i, doc §4.2 bis) : un fichier vidéo privé se
 * charge exactement comme un fichier public (même chemin disque, aucune
 * différence pour le Playback Engine Bridge) — seule la sauvegarde
 * périodique de la progression doit être adressée à la bonne commande
 * (`save_playback_progress` vs. `save_private_playback_progress`). Absent
 * ou `false` pour tout média public existant.
 *
 * 0.4.0 (AetherFy) : champs optionnels pour les médias en streaming
 * (URLs, chaînes YouTube, métadonnées affichées dans l'UI lecteur).
 */
export interface PlayableMedia {
  id: number;
  title: string;
  path: string;
  libraryId: number;
  isPrivate?: boolean;
  /** 0.4.0 (AetherFy) : mode de lecture — "audio" pour le mini-bar, "video" pour le canvas. */
  mode?: "audio" | "video";
  /** 0.4.0 (AetherFy) : nom de la chaîne d'origine (YouTube, etc.). */
  channel?: string;
  /** 0.4.0 (AetherFy) : identifiant YouTube, utilisé pour récupérer l'aperçu. */
  youtubeId?: string;
  /** 0.4.0 (AetherFy) : URL de vignette personnalisée (priorité sur youtubeId). */
  thumbnail?: string;
}

/**
 * Miroir de `services::playback_engine::PlayerStateEvent` — payload de
 * l'événement Tauri `player-state`, diffusé par le Playback Engine Bridge
 * (Étape 3b) à toutes les fenêtres. Champs optionnels : mpv ne signale que
 * les propriétés qui changent, jamais un instantané complet.
 */
export interface PlayerStateEvent {
  position_seconds?: number | null;
  duration_seconds?: number | null;
  playing?: boolean | null;
  ended: boolean;
  error?: string | null;
}

/**
 * État complet de la file de lecture (Étape 3e) — source de vérité unique
 * diffusée par l'événement Tauri `player-queue-changed` (qui remplace
 * l'ancien `player-media-changed`, dont le payload plus étroit — un simple
 * `PlayableMedia | null` — ne pouvait pas porter la position dans la
 * file), à toutes les fenêtres (même mécanisme que les autres événements
 * frontend-à-frontend de ce fichier). `PlayerContext` dérive `currentMedia` de
 * `items[currentIndex]` plutôt que de le stocker séparément : il ne peut
 * donc plus exister de désaccord entre "quel média est actif" et "où en
 * est-on dans la file", la classe de bug corrigée à l'Étape 3b (double
 * `attach_surface` causé par deux mises à jour d'état non atomiques).
 *
 * ⚠️ Volontairement générique : ce type ne connaît ni bibliothèque, ni
 * dossier, ni playlist. Il ne sait manipuler qu'une liste ordonnée de
 * `PlayableMedia` — n'importe quelle fonctionnalité future (playlist
 * persistée, épisodes d'une série, résultats de recherche, glisser-déposer
 * multiple...) peut alimenter la file sans que ce type ni `PlayerContext`
 * n'aient à changer. Voir la documentation technique, §4.2 bis (File de
 * lecture / Queue).
 *
 * À distinguer explicitement d'une future Playlist : la Playlist sera
 * une entité persistée (SQLite), nommée, créée par l'utilisateur — une
 * simple source parmi d'autres capable de produire un
 * `PlaybackQueueState`. La Queue, elle, reste toujours éphémère (RAM
 * uniquement, jamais écrite en base), le temps d'une session de lecture.
 */
export interface PlaybackQueueState {
  /** Liste ordonnée des médias de la file, dans l'ordre de lecture. */
  items: PlayableMedia[];
  /** Index de l'élément en cours dans `items`, ou `null` si rien ne joue
   * (file vide). */
  currentIndex: number | null;
}

/**
 * Une piste (audio ou sous-titre) telle qu'exposée par libmpv pour le
 * fichier chargé — miroir de `services::playback_engine::PlayerTrack`.
 * `lang`/`title` sont `null` quand libmpv ne les connaît pas (courant pour
 * des pistes sans métadonnées embarquées).
 */
export interface PlayerTrack {
  id: number;
  lang: string | null;
  title: string | null;
  selected: boolean;
}

/**
 * Résultat de la commande `player_list_tracks` — miroir de
 * `services::playback_engine::TrackList`. Interrogée à la demande, au clic
 * sur les boutons Piste audio / Sous-titres (pas de flux poussé en continu
 * : la liste des pistes d'un fichier local ne change pas en cours de
 * lecture — voir doc §4.2 bis).
 */
export interface PlayerTrackList {
  audio: PlayerTrack[];
  subtitles: PlayerTrack[];
}

/**
 * Payload de l'événement frontend-à-frontend `player-settings-changed` —
 * diffusé directement entre fenêtres (sans passer par Rust) pour garder
 * volume/muet/vitesse synchronisés entre la fenêtre principale et la
 * fenêtre détachée. Voir `PlayerContext.tsx`.
 */
export interface PlayerSettingsChangedPayload {
  volume: number;
  muted: boolean;
  rate: number;
}