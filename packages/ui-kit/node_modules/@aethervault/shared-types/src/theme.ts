/**
 * Format d'échange des thèmes AetherVault Media.
 *
 * Pensé pour l'import/export local dès maintenant, et pour le partage de
 * thèmes créés par la communauté plus tard (l'échange réel via un service
 * en ligne reste une extension réseau future ; ce format est ce qui rendra
 * cet échange possible sans changer la structure le moment venu).
 *
 * `version` est le numéro de version du *format* (indépendant de la version
 * de l'application). Une évolution future du format incrémentera
 * `THEME_FORMAT_VERSION` et ajoutera une logique de compatibilité dédiée —
 * même principe que les migrations de base de données côté backend
 * (voir db::migrations).
 */
export const THEME_FORMAT_VERSION = 1;

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
  success: string;
  danger: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  author?: string;
  version: number;
  colors: ThemeColors;
}

const REQUIRED_COLOR_KEYS: (keyof ThemeColors)[] = [
  "bg",
  "surface",
  "surfaceHover",
  "border",
  "text",
  "textMuted",
  "accent",
  "accentContrast",
  "success",
  "danger",
];

/**
 * Validation structurelle minimale d'un thème importé : vérifie que la
 * forme générale correspond au format attendu. Ne vérifie pas que les
 * valeurs sont des couleurs CSS valides (le navigateur ignore simplement une
 * valeur invalide sans planter) ni la compatibilité de version — cette
 * dernière est vérifiée séparément par l'appelant (voir `ThemeProvider`),
 * pour distinguer clairement "structure invalide" de "version trop récente".
 */
export function isValidThemeDefinition(value: unknown): value is ThemeDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return false;
  if (typeof candidate.version !== "number") return false;
  if (typeof candidate.colors !== "object" || candidate.colors === null) return false;

  const colors = candidate.colors as Record<string, unknown>;
  return REQUIRED_COLOR_KEYS.every((key) => typeof colors[key] === "string");
}
