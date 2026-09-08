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
 * Lit le fond personnalisé (commande `get_home_backdrop`) et se
 * rafraîchit via l'événement `avm-home-backdrop-changed` déjà émis par
 * la section Paramètres « Fond de la page d'accueil ».
 */
export function AppBackdrop() {
  const [backdrop, setBackdrop] = useState<string | null>(null);

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
    };
    refresh();
    window.addEventListener("avm-home-backdrop-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("avm-home-backdrop-changed", refresh);
    };
  }, []);

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