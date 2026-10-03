import "./styles/fonts.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { applyPersistedTheme } from "./theme/persistedCustomTheme";

// CORRECTIF (le thème se réinitialise au redémarrage) : réapplique, avant
// le premier rendu, le thème choisi dans Paramètres → Personnalisation
// lors d'une session précédente (voir SettingsPage.tsx).
applyPersistedTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
