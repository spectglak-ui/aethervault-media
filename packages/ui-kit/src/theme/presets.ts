import { THEME_FORMAT_VERSION, type ThemeDefinition } from "@aethervault/shared-types";

/**
 * Thèmes fournis avec l'application. Définis avec la même structure
 * `ThemeDefinition` qu'un thème importé : aucun traitement de faveur,
 * seule leur présence par défaut (et le fait qu'ils ne peuvent pas être
 * supprimés) les distingue d'un thème communautaire.
 */
export const darkTheme: ThemeDefinition = {
  id: "aethervault-dark",
  name: "AetherVault Sombre",
  author: "AetherVault Media",
  version: THEME_FORMAT_VERSION,
  colors: {
    bg: "#14161a",
    surface: "#1d2026",
    surfaceHover: "#242830",
    border: "#2a2e37",
    text: "#eef0f3",
    textMuted: "#9aa0ab",
    accent: "#7c5cff",
    accentContrast: "#ffffff",
    success: "#6ee7a8",
    danger: "#f28b82",
  },
};

export const lightTheme: ThemeDefinition = {
  id: "aethervault-light",
  name: "AetherVault Clair",
  author: "AetherVault Media",
  version: THEME_FORMAT_VERSION,
  colors: {
    bg: "#f5f6f8",
    surface: "#ffffff",
    surfaceHover: "#eef0f4",
    border: "#e2e4e9",
    text: "#14161a",
    textMuted: "#5b616c",
    accent: "#7c5cff",
    accentContrast: "#ffffff",
    success: "#1f9d5c",
    danger: "#c53d34",
  },
};

export const BUILTIN_THEMES: ThemeDefinition[] = [darkTheme, lightTheme];
