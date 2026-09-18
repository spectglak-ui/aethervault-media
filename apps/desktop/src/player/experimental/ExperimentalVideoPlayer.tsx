import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { IconButton, Slider } from "@aethervault/ui-kit";
import { convertFileSrc } from "@tauri-apps/api/core";
import { formatTime } from "../formatTime";
import "./experimentalVideoPlayer.css";

interface ExperimentalVideoPlayerProps {
  filePath: string;
}

/**
 * Messages `HTMLMediaElement.error.code` — le code 4
 * (`MEDIA_ERR_SRC_NOT_SUPPORTED`) est le résultat ATTENDU pour un fichier
 * que le navigateur ne sait pas lire nativement (MKV avec codecs non pris
 * en charge, par exemple) : ce n'est pas un bug de ce composant, c'est
 * précisément ce que la Phase 2 (remuxage à la volée) devra résoudre. Les
 * codes 1-3 indiqueraient au contraire un vrai problème.
 */
const MEDIA_ERROR_MESSAGES: Record<number, string> = {
  1: "Chargement interrompu (MEDIA_ERR_ABORTED).",
  2: "Erreur réseau pendant le chargement (MEDIA_ERR_NETWORK).",
  3: "Décodage impossible — fichier corrompu, ou codec partiellement pris en charge (MEDIA_ERR_DECODE).",
  4: "Conteneur/codec non pris en charge nativement par le lecteur du navigateur (MEDIA_ERR_SRC_NOT_SUPPORTED). C'est attendu pour un fichier qui nécessiterait un remuxage — voir la Phase 2 du plan de migration, pas encore implémentée.",
};

/**
 * Lecteur `<video>` natif, entièrement séparé de `PlayerContext`/
 * `PlayerSurface`/`playback_engine` — Phase 1 de la validation ciblée
 * `<video>` + MSE (voir le rapport de migration associé). Ne touche à
 * AUCUN fichier du lecteur actuel : c'est un outil de test isolé, pas un
 * remplacement.
 *
 * `convertFileSrc(filePath)` s'appuie sur le protocole `asset:` déjà
 * activé dans `tauri.conf.json` (`assetProtocol.enable`, portée `**`) —
 * lui-même documenté par Tauri comme prenant en charge les requêtes
 * `Range` HTTP, nécessaires pour que `<video>` puisse chercher dans le
 * fichier sans le charger en entier. Aucun serveur ni protocole
 * personnalisé écrit pour cette phase : uniquement ce que Tauri fournit
 * déjà.
 *
 * Recherche/volume volontairement SANS temporisation ici (contrairement
 * au lecteur principal, voir `PlayerContext.tsx`) : `video.currentTime`
 * est géré nativement par le navigateur, pas par un aller-retour IPC vers
 * un moteur externe — une partie de ce qu'on cherche à valider est
 * justement de voir si ce comportement natif absorbe mieux l'interaction
 * continue qu'un curseur, sans avoir besoin de notre propre correctif.
 */
export function ExperimentalVideoPlayer({ filePath }: ExperimentalVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * ⚠️ Correctif (retour de test réel — léger ralentissement systématique,
   * indépendant du fichier) : `onTimeUpdate` peut se déclencher plusieurs
   * fois par seconde, chaque appel provoquant un rendu React complet de
   * ce composant (curseur, libellés de temps) sur le même thread que
   * l'affichage de la vidéo — un candidat plausible pour un manque de
   * fluidité, indépendant du fichier lu. `video.currentTime` continue
   * d'avancer nativement, sans lien avec cette limite : seule la
   * fréquence de mise à jour de l'AFFICHAGE React est réduite (5 fois par
   * seconde suffit largement à l'œil pour un curseur de progression).
   */
  const lastPositionUpdateRef = useRef(0);

  const src = convertFileSrc(filePath);

  // Nouveau fichier : repartir d'un état propre plutôt que de garder la
  // position/l'erreur du précédent.
  useEffect(() => {
    setError(null);
    setPosition(0);
    setDuration(0);
    setIsPlaying(false);
  }, [filePath]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((err) => setError(String(err)));
    } else {
      video.pause();
    }
  };

  const handleError = () => {
    const video = videoRef.current;
    const code = video?.error?.code;
    setError(
      code !== undefined
        ? MEDIA_ERROR_MESSAGES[code] ?? `Erreur de lecture inconnue (code ${code}).`
        : "Erreur de lecture inconnue."
    );
  };

  return (
    <div className="avm-experimental-player">
      <video
        ref={videoRef}
        src={src}
        className="avm-experimental-player__video"
        onTimeUpdate={(e) => {
          const now = performance.now();
          if (now - lastPositionUpdateRef.current >= 200) {
            lastPositionUpdateRef.current = now;
            setPosition(e.currentTarget.currentTime);
          }
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={handleError}
      />

      {error && (
        <div className="avm-experimental-player__error" role="alert">
          {error}
        </div>
      )}

      <div className="avm-experimental-player__controls">
        <IconButton label={isPlaying ? "Pause" : "Lecture"} onClick={togglePlay}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </IconButton>

        <span className="avm-experimental-player__time">{formatTime(position)}</span>

        <div className="avm-experimental-player__seek">
          <Slider
            value={position}
            max={duration || 0.1}
            step={0.1}
            onChange={(value) => {
              setPosition(value);
              if (videoRef.current) videoRef.current.currentTime = value;
            }}
            ariaLabel="Progression"
          />
        </div>

        <span className="avm-experimental-player__time">{formatTime(duration)}</span>

        <IconButton
          label={muted ? "Réactiver le son" : "Couper le son"}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (videoRef.current) videoRef.current.muted = next;
          }}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </IconButton>

        <div className="avm-experimental-player__volume">
          <Slider
            value={muted ? 0 : volume}
            max={1}
            step={0.05}
            onChange={(value) => {
              setVolume(value);
              if (videoRef.current) videoRef.current.volume = value;
            }}
            ariaLabel="Volume"
          />
        </div>
      </div>
    </div>
  );
}
