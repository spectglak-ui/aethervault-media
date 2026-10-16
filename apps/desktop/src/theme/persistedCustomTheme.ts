/**
 * CORRECTIF (le thème se réinitialise au redémarrage) :
 *
 * `SettingsPage.tsx` (`ThemeCustomizerSection`) appliquait le thème
 * choisi UNIQUEMENT en style inline sur `<html>`
 * (`document.documentElement.style.setProperty(...)`), sans jamais rien
 * écrire nulle part — au redémarrage, le style inline disparaît avec la
 * page et l'app retombe sur la feuille de style statique par défaut.
 *
 * Ce petit module centralise la persistance (lecture/écriture) dans
 * `localStorage`, pour que `main.tsx` puisse réappliquer le thème
 * choisi dès le démarrage, avant le premier rendu.
 *
 * Volontairement séparé du système `ThemeProvider` de
 * `@aethervault/ui-kit` (plus riche — thèmes complets importables/
 * exportables — mais non branché sur cette page aujourd'hui : voir le
 * commentaire dans `ThemeCustomizerSection`). Unifier les deux est une
 * amélioration future possible, pas nécessaire pour corriger ce bug.
 */
const STORAGE_KEY = "aethervault:settings:theme";

export interface PersistedTheme {
  preset: string;
  vars: Record<string, string>;
}

/** Variables du thème « Transparent » (source unique : aussi utilisée par
 *  le preset de Paramètres → Thème). */
export const TRANSPARENT_THEME_VARS: Record<string, string> = {
  "--color-bg": "rgba(20, 22, 26, 0.75)",
  "--color-surface": "rgba(29, 32, 38, 0.65)",
  "--color-surface-hover": "rgba(36, 40, 48, 0.75)",
  "--color-border": "rgba(42, 46, 55, 0.5)",
  "--color-accent": "#7c5cff",
  "--color-accent-hover": "#6a4de0",
  "--color-text": "#eef0f3",
  "--color-text-muted": "#9aa0ab",
  "--color-sidebar": "rgba(16, 18, 22, 0.60)",
  "--color-card": "rgba(29, 32, 38, 0.55)",
  "--color-danger": "#f28b82",
  "--color-success": "#6ee7a8",
  "--color-warning": "#f5c04e",
  "--sidebar-width": "260px",
  "--radius-sm": "6px",
  "--radius-md": "10px",
  "--radius-lg": "16px",
};

/** Thème appliqué tant que l'utilisateur n'en a choisi aucun. */
const DEFAULT_THEME: PersistedTheme = { preset: "transparent", vars: TRANSPARENT_THEME_VARS };

export function readPersistedTheme(): PersistedTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Rien d'enregistré : thème par défaut (Transparent). Un choix explicite
    // de l'utilisateur — y compris « default » — est toujours enregistré et prime.
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as PersistedTheme).vars !== "object"
    ) {
      return DEFAULT_THEME;
    }
    return parsed as PersistedTheme;
  } catch {
    return DEFAULT_THEME;
  }
}

export function writePersistedTheme(theme: PersistedTheme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Stockage indisponible (quota, mode privé…) : le thème reste actif
    // pour la session en cours, simplement pas persisté — pas fatal.
  }
}

/** Appelé une fois, avant le premier rendu (voir `main.tsx`). */
export function applyPersistedTheme(): void {
  const saved = readPersistedTheme();
  if (!saved) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(saved.vars)) {
    root.style.setProperty(key, value);
  }
}
