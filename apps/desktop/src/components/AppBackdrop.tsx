import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getBuiltinImage, getBuiltinVideo } from "../lib/builtinBackdrops";
import { getSelectedCustomPath } from "../lib/animatedBackdropLibrary";

/**
0.5.4 — Fond d'arrière-plan GLOBAL : une couche FIXE plein-fenêtre,
derrière la sidebar, la barre du haut et toutes les pages.
Indispensable au thème Transparent : sans elle, les surfaces semi-
transparentes n'ont rien à laisser transparaître (elles flottent sur
le fond gris par défaut de la fenêtre), et le fond personnalisé de
l'Accueil reste enfermé dans la zone de contenu.
FONCTIONNALITÉ (fond animé) : quand activé (Paramètres → Fond animé),
une vidéo en boucle remplace le fond image, PARTOUT — cette couche
étant déjà globale, il suffit de choisir laquelle des deux rendre.
Pas encore de réglage par page (prévu plus tard) : c'est l'un ou
l'autre, pour tout le logiciel.
Lit le fond personnalisé (commandes `get_home_backdrop`/
`get_home_backdrop_video`/`get_backdrop_video_enabled`) et se
rafraîchit via l'événement `avm-home-backdrop-changed`, déjà émis par
la section Paramètres « Fond de la page d'accueil » et maintenant
aussi par « Fond animé ».
0.8.0 — BIBLIOTHÈQUE PERSONNELLE : la vidéo choisie dans la
bibliothèque personnelle (Paramètres → Fond animé → Bibliothèque)
est PRIORITAIRE sur la vidéo personnelle historique et sur les fonds
intégrés ; « Revenir aux fonds par défaut » restaure l'ancien ordre.
*/
export function AppBackdrop() {
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [videoBackdrop, setVideoBackdrop] = useState<string | null>(null);
  // Activé par défaut (même défaut que le backend) : évite un flash du fond image au démarrage.
  const [videoEnabled, setVideoEnabled] = useState(true);
  // 0.8.0 — vidéo choisie dans la bibliothèque personnelle (synchrone).
  const [customPath, setCustomPath] = useState<string | null>(() => getSelectedCustomPath());
  // Fonds intégrés (Paramètres) : utilisés seulement en l'absence de fond personnel.
  const [builtinImage, setBuiltinImageState] = useState(getBuiltinImage);
  const [builtinVideo, setBuiltinVideoState] = useState(getBuiltinVideo);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setBuiltinImageState(getBuiltinImage());
      setBuiltinVideoState(getBuiltinVideo());
      setCustomPath(getSelectedCustomPath());
      invoke<string | null>("get_home_backdrop")
        .then((path) => {
          if (alive) setBackdrop(path);
        })
        .catch(() => {
          if (alive) setBackdrop(null);
        });
      invoke<string | null>("get_home_backdrop_video")
        .then((path) => {
          if (alive) setVideoBackdrop(path);
        })
        .catch(() => {
          if (alive) setVideoBackdrop(null);
        });
      invoke<boolean>("get_backdrop_video_enabled")
        .then((value) => {
          if (alive) setVideoEnabled(value);
        })
        .catch(() => {
          if (alive) setVideoEnabled(false);
        });
    };
    refresh();
    window.addEventListener("avm-home-backdrop-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("avm-home-backdrop-changed", refresh);
    };
  }, []);

  // 0.8.0 — priorité : bibliothèque personnelle > vidéo personnelle
  // historique > fond animé intégré.
  const videoSrc = customPath
    ? convertFileSrc(customPath)
    : videoBackdrop
      ? convertFileSrc(videoBackdrop)
      : (builtinVideo?.src ?? null);

  if (videoEnabled && videoSrc) {
    return (
      <video
        key={videoSrc}
        className="avm-app-backdrop avm-app-backdrop--video"
        aria-hidden="true"
        src={videoSrc}
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }
  const imageSrc = backdrop ? convertFileSrc(backdrop) : (builtinImage?.src ?? null);
  return (
    <div
      className="avm-app-backdrop"
      aria-hidden="true"
      style={imageSrc ? { backgroundImage: `url("${imageSrc}")` } : undefined}
    />
  );
}