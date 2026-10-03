import { useEffect } from "react";
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
import { applyPersistedTheme } from "./theme/persistedCustomTheme";

/**
 * Racine de composition. Aiguille sur le label de la fenêtre Tauri
 * courante : la fenêtre principale ("main") rend l'application complète
 * (gate d'authentification puis routeur + shell) ; la fenêtre détachée
 * du lecteur ("player") rend une mise en page dédiée, beaucoup plus
 * légère — voir `DetachedPlayerWindow`.
 */
function App() {
  const windowLabel = getWindowLabel();

  // CORRECTIF (thème personnalisé pas appliqué au démarrage tant qu'on ne
  // reclique pas dessus) : `main.tsx` réapplique déjà le thème persisté
  // AVANT le premier rendu, mais `ThemeProvider` (ci-dessous) a son PROPRE
  // système de thème (non branché sur un bouton aujourd'hui, mais actif
  // par défaut) qui écrase les mêmes variables CSS dans SON PROPRE effet
  // de montage — lequel se déclenche juste APRÈS l'exécution synchrone de
  // `main.tsx`, donc après elle. Comme React déclenche les effets des
  // enfants avant ceux des parents, cet effet ici (posé sur `App`, PARENT
  // de `ThemeProvider`) s'exécute forcément APRÈS le sien : il gagne la
  // course pour de bon, à chaque démarrage.
  useEffect(() => {
    applyPersistedTheme();
  }, []);

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