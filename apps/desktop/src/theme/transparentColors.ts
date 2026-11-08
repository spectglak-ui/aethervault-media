/**
 * Personnalisation des couleurs du thème « Transparent » (0.7.8).
 *
 * L'éditeur détaillé de Paramètres → Thème expose chaque variable CSS avec
 * un sélecteur de couleur opaque : modifier `--color-bg` ou `--color-surface`
 * y fait perdre la transparence (le sélecteur natif ne gère pas l'alpha).
 * Ce module part d'un modèle plus parlant — une couleur d'accent, et pour
 * le fond / les panneaux / la barre latérale une teinte ET une opacité — et
 * en déduit TOUTES les variables du thème (survol, bordures, cartes, texte
 * atténué…), en conservant l'alpha. Le résultat est écrit dans le même thème
 * persisté que le reste (`persistedCustomTheme`) : il est donc réappliqué
 * au démarrage comme tout autre thème.
 */
import {
  TRANSPARENT_THEME_VARS,
  readPersistedTheme,
  writePersistedTheme,
} from "./persistedCustomTheme";

export interface TransparentColors {
  accent: string;
  background: string;
  backgroundOpacity: number;
  panels: string;
  panelsOpacity: number;
  sidebar: string;
  sidebarOpacity: number;
  text: string;
}

/** Valeurs exactes de `TRANSPARENT_THEME_VARS` (le thème tel qu'il est livré). */
export const DEFAULT_TRANSPARENT_COLORS: TransparentColors = {
  accent: "#7c5cff",
  background: "#14161a",
  backgroundOpacity: 0.75,
  panels: "#1d2026",
  panelsOpacity: 0.65,
  sidebar: "#101216",
  sidebarOpacity: 0.6,
  text: "#eef0f3",
};

export interface TransparentPalette {
  id: string;
  label: string;
  colors: TransparentColors;
}

const palette = (
  id: string,
  label: string,
  accent: string,
  background: string,
  panels: string,
  sidebar: string,
  text: string
): TransparentPalette => ({
  id,
  label,
  colors: { ...DEFAULT_TRANSPARENT_COLORS, accent, background, panels, sidebar, text },
});

/** Ambiances prêtes à l'emploi (les opacités restent celles du thème livré). */
export const TRANSPARENT_PALETTES: TransparentPalette[] = [
  { id: "violet", label: "Violet nuit", colors: DEFAULT_TRANSPARENT_COLORS },
  palette("ocean", "Océan", "#0ea5e9", "#0a1420", "#122233", "#08101a", "#e8f1f8"),
  palette("foret", "Forêt", "#22c55e", "#0c1510", "#14231a", "#09110c", "#e9f3ec"),
  palette("crepuscule", "Crépuscule", "#ec4899", "#180d17", "#251524", "#110a10", "#f6ecf4"),
  palette("ambre", "Ambre", "#f59e0b", "#17120a", "#231b0f", "#100c06", "#f7f0e4"),
  palette("cinema", "Rouge cinéma", "#ff2e63", "#160b0f", "#231318", "#0f0709", "#f6eaee"),
  palette("graphite", "Graphite", "#94a3b8", "#121316", "#1c1e22", "#0d0e10", "#eceef0"),
];

export const ACCENT_SWATCHES = ["#7c5cff", "#3b82f6", "#0ea5e9", "#2ec4b6", "#22c55e", "#f59e0b", "#ec4899", "#ff2e63"];

// ------------------------------------------------------------- maths couleur
type Rgb = [number, number, number];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}

/** `#rgb`, `#rrggbb`, `rgb(…)`, `rgba(…)` → teinte hexadécimale + opacité ; `null` si illisible. */
export function parseCssColor(value: string | undefined): { hex: string; alpha: number } | null {
  if (!value) return null;
  const v = value.trim();
  if (v.startsWith("#")) return { hex: rgbToHex(hexToRgb(v)), alpha: 1 };
  const m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { hex: rgbToHex([+m[1], +m[2], +m[3]]), alpha: clamp(alpha, 0, 1) };
}

export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rapport de contraste WCAG entre deux couleurs opaques (1 → 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(clamp(alpha, 0, 1) * 100) / 100})`;
};

// -------------------------------------------------- modèle ⇄ variables CSS
/** Toutes les variables du thème déduites des couleurs choisies (alpha conservé). */
export function varsFromColors(c: TransparentColors): Record<string, string> {
  return {
    ...TRANSPARENT_THEME_VARS,
    "--color-bg": rgba(c.background, c.backgroundOpacity),
    "--color-surface": rgba(c.panels, c.panelsOpacity),
    "--color-surface-hover": rgba(mixHex(c.panels, c.text, 0.07), c.panelsOpacity + 0.1),
    "--color-border": rgba(mixHex(c.panels, c.text, 0.075), 0.5),
    "--color-accent": c.accent,
    "--color-accent-hover": mixHex(c.accent, "#000000", 0.14),
    // Texte posé sur l'accent (boutons primaires) : noir ou blanc selon le contraste.
    "--color-accent-contrast": contrastRatio(c.accent, "#ffffff") >= 3 ? "#ffffff" : "#111111",
    "--color-text": c.text,
    "--color-text-muted": mixHex(c.text, c.background, 0.36),
    "--color-sidebar": rgba(c.sidebar, c.sidebarOpacity),
    "--color-card": rgba(c.panels, Math.max(0.1, c.panelsOpacity - 0.1)),
  };
}

/** Relit les couleurs depuis un thème persisté (valeurs manquantes → thème livré). */
export function colorsFromVars(vars: Record<string, string>): TransparentColors {
  const d = DEFAULT_TRANSPARENT_COLORS;
  const bg = parseCssColor(vars["--color-bg"]);
  const surface = parseCssColor(vars["--color-surface"]);
  const sidebar = parseCssColor(vars["--color-sidebar"]);
  return {
    accent: parseCssColor(vars["--color-accent"])?.hex ?? d.accent,
    background: bg?.hex ?? d.background,
    backgroundOpacity: bg?.alpha ?? d.backgroundOpacity,
    panels: surface?.hex ?? d.panels,
    panelsOpacity: surface?.alpha ?? d.panelsOpacity,
    sidebar: sidebar?.hex ?? d.sidebar,
    sidebarOpacity: sidebar?.alpha ?? d.sidebarOpacity,
    text: parseCssColor(vars["--color-text"])?.hex ?? d.text,
  };
}

/** Applique les couleurs à l'interface (en direct) ET les enregistre comme thème Transparent. */
export function applyTransparentColors(colors: TransparentColors): void {
  const vars = varsFromColors(colors);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  writePersistedTheme({ preset: "transparent", vars });
}

/** Thème Transparent livré, restauré tel quel. */
export function resetTransparentColors(): TransparentColors {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(TRANSPARENT_THEME_VARS)) root.style.setProperty(key, value);
  root.style.removeProperty("--color-accent-contrast");
  writePersistedTheme({ preset: "transparent", vars: { ...TRANSPARENT_THEME_VARS } });
  return DEFAULT_TRANSPARENT_COLORS;
}

export function currentTransparentColors(): { active: boolean; preset: string; colors: TransparentColors } {
  const saved = readPersistedTheme();
  return {
    active: saved?.preset === "transparent",
    preset: saved?.preset ?? "transparent",
    colors: colorsFromVars(saved?.vars ?? {}),
  };
}
