import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/**
 * 0.5.4 — Fond d'arrière-plan GLOBAL : une couche FIXE plein-fenêtre,
 * derrière la sidebar, la barre du haut et toutes les pages.
 * Indispensable au thème Transparent : sans elle, les surfaces semi-
 * transparentes n'ont rien à laisser transparaître (elles flottent sur
 * le fond gris par défaut de la fenêtre), et le fond personnalisé de
 * l'Accueil reste enfermé dans la zone de contenu.
 *
 * FONCTIONNALITÉ (fond animé) : quand activé (Paramètres → Fond animé),
 * une vidéo en boucle remplace le fond image, PARTOUT — cette couche
 * étant déjà globale, il suffit de choisir laquelle des deux rendre.
 * Pas encore de réglage par page (prévu plus tard) : c'est l'un ou
 * l'autre, pour tout le logiciel.
 *
 * Lit le fond personnalisé (commandes `get_home_backdrop`/
 * `get_home_backdrop_video`/`get_backdrop_video_enabled`) et se
 * rafraîchit via l'événement `avm-home-backdrop-changed`, déjà émis par
 * la section Paramètres « Fond de la page d'accueil » et maintenant
 * aussi par « Fond animé ».
 */
export function AppBackdrop() {
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [videoBackdrop, setVideoBackdrop] = useState<string | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
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

  if (videoEnabled && videoBackdrop) {
    return (
      <video
        className="avm-app-backdrop avm-app-backdrop--video"
        aria-hidden="true"
        src={convertFileSrc(videoBackdrop)}
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }

  return (
    <div
      className="avm-app-backdrop"
      aria-hidden="true"
      style={
        backdrop ? { backgroundImage: `url("${convertFileSrc(backdrop)}")` } : undefined
      }
    />
  );
}