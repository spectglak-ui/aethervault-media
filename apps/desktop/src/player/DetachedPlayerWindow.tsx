import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePlayer } from "./PlayerContext";
import { PlayerSurface } from "./PlayerSurface";
import { PlayerControls } from "./PlayerControls";
import { windowApi } from "../features/window/api";
import "../layout/layout.css";
import "./detachedPlayerWindow.css";

/**
 * Fenêtre détachée du lecteur (PiP) — fenêtre PRÉ-CRÉÉE au démarrage
 * (déclarée dans tauri.conf.json, invisible), affichée/masquée par
 * show()/hide() côté Rust (commands::window).
 *
 * Garde-fou : `PlayerSurface` n'est monté qu'entre `pip-activate` et
 * `pip-deactivate`, sinon ce webview invisible volerait la surface de
 * rendu de la fenêtre principale.
 *
 * Montage DIFFÉRÉ de 500 ms après `pip-activate` — un canal Tauri créé
 * pendant que le webview n'est pas encore réellement présenté à l'écran
 * reste muet (observé en test réel).
 */
export function DetachedPlayerWindow() {
  const { currentMedia } = usePlayer();
  const [active, setActive] = useState(false);

  useEffect(() => {
    void windowApi.markPlayerReady();
    const unlisteners: Array<() => void> = [];
    void listen("pip-activate", () => {
      window.setTimeout(() => setActive(true), 500);
    }).then((unlisten) => unlisteners.push(unlisten));
    void listen("pip-deactivate", () => setActive(false)).then((unlisten) =>
      unlisteners.push(unlisten)
    );
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, []);

  if (!active || !currentMedia) {
    return (
      <div className="avm-detached-player">
        <div className="avm-detached-player__titlebar" data-tauri-drag-region>
          <span className="avm-detached-player__titlebar-title">
            {currentMedia ? currentMedia.title : "AetherVault Media"}
          </span>
        </div>
        <div className="avm-detached-player__empty">
          {active ? "Aucune lecture en cours." : "Lecteur détaché inactif."}
        </div>
      </div>
    );
  }

  return (
    <div className="avm-detached-player">
      <div className="avm-detached-player__titlebar" data-tauri-drag-region>
        <span className="avm-detached-player__titlebar-title">{currentMedia.title}</span>
      </div>
      <PlayerSurface className="avm-detached-player__surface" />
      <PlayerControls variant="detached" />
    </div>
  );
}