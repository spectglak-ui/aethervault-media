import { RouterProvider } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "@aethervault/ui-kit";
import { PlayerProvider } from "./player/PlayerContext";
import { ActiveProfileProvider } from "./profile/ActiveProfileContext";
import { DetachedPlayerWindow } from "./player/DetachedPlayerWindow";
import { getWindowLabel } from "./window/getWindowLabel";
import { AuthGate } from "./auth/AuthGate";
import { router } from "./router";
import { AppBackdrop } from "./components/AppBackdrop";   // ← AJOUT

/**
 * Racine de composition. Aiguille sur le label de la fenêtre Tauri
 * courante : la fenêtre principale ("main") rend l'application complète
 * (gate d'authentification puis routeur + shell) ; la fenêtre détachée
 * du lecteur ("player") rend une mise en page dédiée, beaucoup plus
 * légère — voir `DetachedPlayerWindow`.
 */
function App() {
  const windowLabel = getWindowLabel();
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        {windowLabel === "player" ? (
          <ActiveProfileProvider>
            <PlayerProvider>
              <DetachedPlayerWindow />
            </PlayerProvider>
          </ActiveProfileProvider>
        ) : (
          <AuthGate>
            <ActiveProfileProvider>
              <PlayerProvider>
                <AppBackdrop />                 {/* ← AJOUT */}
                <RouterProvider router={router} />
              </PlayerProvider>
            </ActiveProfileProvider>
          </AuthGate>
        )}
      </ThemeProvider>
    </MotionConfig>
  );
}

export default App;