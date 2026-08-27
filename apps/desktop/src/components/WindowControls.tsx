import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "@aethervault/ui-kit";

/**
 * Boutons réduire / agrandir / fermer de la fenêtre principale frameless
 * (Étape 7) — remplacent la barre de titre native une fois
 * `"decorations": false` activé dans tauri.conf.json. L'état « agrandi »
 * est resynchronisé à chaque redimensionnement pour basculer l'icône.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    let unlisten: (() => void) | undefined;
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const win = getCurrentWindow();

  return (
    <div className="avm-window-controls">
      <IconButton label="Réduire" onClick={() => void win.minimize()}>
        <Minus size={14} />
      </IconButton>
      <IconButton
        label={maximized ? "Restaurer" : "Agrandir"}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <Copy size={13} /> : <Square size={13} />}
      </IconButton>
      <IconButton label="Fermer" onClick={() => void win.close()}>
        <X size={14} />
      </IconButton>
    </div>
  );
}