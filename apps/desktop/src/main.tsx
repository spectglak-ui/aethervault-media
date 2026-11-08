import "./styles/fonts.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { applyPersistedTheme } from "./theme/persistedCustomTheme";
import { installUiSoundArming } from "./features/sound/uiSounds";

// CORRECTIF (le thème se réinitialise au redémarrage) : réapplique, avant
// le premier rendu, le thème choisi dans Paramètres → Personnalisation
// lors d'une session précédente (voir SettingsPage.tsx).
applyPersistedTheme();
// 0.7.8 — sons d'interface : le moteur audio démarre au premier geste de l'utilisateur.
installUiSoundArming();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
