import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Label de la fenêtre Tauri courante ("main" aujourd'hui). Sert de point
 * d'aiguillage pour les futures fenêtres secondaires (lecteur détaché,
 * Étape 3) : chaque fenêtre chargera le même bundle frontend, et ce label
 * permettra de savoir quelle mise en page rendre (voir `App.tsx`).
 *
 * Enveloppé dans un try/catch : reste robuste si jamais exécuté hors d'un
 * contexte Tauri (ex. un futur test en environnement navigateur seul).
 */
export function getWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}
