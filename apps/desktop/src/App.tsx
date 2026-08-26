import { RouterProvider } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "@aethervault/ui-kit";
import { PlayerProvider } from "./player/PlayerContext";
import { ActiveProfileProvider } from "./profile/ActiveProfileContext";
import { DetachedPlayerWindow } from "./player/DetachedPlayerWindow";
import { getWindowLabel } from "./window/getWindowLabel";
import { AuthGate } from "./auth/AuthGate";
import { router } from "./router";

/**
 * Racine de composition. Aiguille sur le label de la fenêtre Tauri
 * courante : la fenêtre principale ("main") rend l'application complète
 * (gate d'authentification puis routeur + shell) ; la fenêtre détachée
 * du lecteur ("player") rend une mise en page dédiée, beaucoup plus
 * légère — voir `DetachedPlayerWindow`.
 *
 * Étape 6c : `AuthGate` enveloppe TOUT le shell de la fenêtre principale
 * (intro animée, puis login ou assistant de premier démarrage). Tant que
 * le gate n'a pas rendu la main, AUCUN provider métier n'est monté :
 * aucune commande métier ne peut être interrogée sans profil actif —
 * cohérent avec le démarrage Rust à `active_profile_id = None`.
 *
 * Les deux branches sont enveloppées dans leur PROPRE `PlayerProvider` :
 * chaque fenêtre Tauri est un runtime JS distinct, donc chacune a sa
 * propre instance de contexte. Ce sont les événements Tauri diffusés par
 * `PlayerProvider` qui les gardent synchronisées, pas un état partagé au
 * niveau JS — il n'y en a pas.
 *
 * `MotionConfig reducedMotion="user"` désactive automatiquement les
 * animations `framer-motion` (y compris celles de l'intro AuthGate) si
 * le système d'exploitation demande de réduire les animations.
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