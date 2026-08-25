import { RouterProvider } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "@aethervault/ui-kit";
import { PlayerProvider } from "./player/PlayerContext";
import { ActiveProfileProvider } from "./profile/ActiveProfileContext";
import { DetachedPlayerWindow } from "./player/DetachedPlayerWindow";
import { getWindowLabel } from "./window/getWindowLabel";
import { router } from "./router";

/**
 * Racine de composition. Aiguille sur le label de la fenêtre Tauri
 * courante : la fenêtre principale ("main") rend l'application complète
 * (routeur + shell) ; la fenêtre détachée du lecteur ("player", créée
 * dynamiquement par `commands::window::open_player_window` à l'Étape 3b)
 * rend une mise en page dédiée, beaucoup plus légère — voir
 * `DetachedPlayerWindow`.
 *
 * Les deux branches sont enveloppées dans leur PROPRE `PlayerProvider` :
 * chaque fenêtre Tauri est un runtime JS distinct, donc chacune a sa
 * propre instance de contexte. Ce sont les événements Tauri diffusés par
 * `PlayerProvider` (voir ce fichier) qui les gardent synchronisées, pas un
 * état partagé au niveau JS — il n'y en a pas.
 *
 * `MotionConfig reducedMotion="user"` désactive automatiquement les
 * animations `framer-motion` si le système d'exploitation demande de
 * réduire les animations — pas de logique à dupliquer ailleurs.
 */
function App() {
  const windowLabel = getWindowLabel();

  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <ActiveProfileProvider>
          <PlayerProvider>
            {windowLabel === "player" ? (
              <DetachedPlayerWindow />
            ) : (
              <RouterProvider router={router} />
            )}
          </PlayerProvider>
        </ActiveProfileProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
