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

export function readPersistedTheme(): PersistedTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as PersistedTheme).vars !== "object"
    ) {
      return null;
    }
    return parsed as PersistedTheme;
  } catch {
    return null;
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
