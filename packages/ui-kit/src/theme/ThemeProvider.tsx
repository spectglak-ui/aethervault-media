import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  THEME_FORMAT_VERSION,
  isValidThemeDefinition,
  type ThemeDefinition,
} from "@aethervault/shared-types";
import { BUILTIN_THEMES, darkTheme } from "./presets";

const STORAGE_KEY_ACTIVE = "aethervault:theme:active";
const STORAGE_KEY_CUSTOM = "aethervault:theme:custom";

function readCustomThemes(): ThemeDefinition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CUSTOM);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidThemeDefinition);
  } catch {
    return [];
  }
}

function readActiveThemeId(): string {
  if (typeof window === "undefined") return darkTheme.id;
  return window.localStorage.getItem(STORAGE_KEY_ACTIVE) ?? darkTheme.id;
}

/** Convertit une clé camelCase (ex. "surfaceHover") en variable CSS kebab-case. */
function colorKeyToCssVar(key: string): string {
  return `--color-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * Applique un thème en injectant ses couleurs comme variables CSS inline
 * sur `<html>`. Contrairement à une simple bascule d'attribut `data-theme`
 * entre deux jeux de règles CSS statiques, cette approche fonctionne pour
 * n'importe quel thème — y compris un thème importé dont les couleurs sont
 * inconnues au moment de la compilation.
 *
 * `tokens.css` conserve malgré tout des blocs statiques pour "dark"/"light" :
 * ils servent de valeurs par défaut avant que ce code s'exécute (évite un
 * flash de couleurs non stylées), mais sont ensuite prioritaires écrasés par
 * les propriétés inline posées ici.
 */
function applyThemeToDocument(theme: ThemeDefinition) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme.id);
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(colorKeyToCssVar(key), value);
  }
}

interface ThemeContextValue {
  /** Thèmes prédéfinis + thèmes importés par l'utilisateur. */
  themes: ThemeDefinition[];
  activeTheme: ThemeDefinition;
  setActiveThemeId: (id: string) => void;
  /** Lit un fichier `.json` et l'ajoute à la liste des thèmes disponibles. */
  importTheme: (file: File) => Promise<void>;
  /** Télécharge un thème au format JSON (partage/sauvegarde manuelle). */
  exportTheme: (id: string) => void;
  /** Un thème prédéfini ne peut pas être supprimé. */
  removeCustomTheme: (id: string) => void;
  isBuiltinTheme: (id: string) => boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Fournit le thème visuel courant à toute l'application, gère la liste des
 * thèmes disponibles (prédéfinis + importés), et expose l'import/export.
 *
 * Portée volontairement limitée à cette étape : tout reste local
 * (`localStorage` + fichiers JSON manuels). Le partage communautaire réel
 * (découverte/upload en ligne) est une extension réseau future — ce système
 * en est la fondation, pas l'implémentation complète.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>(readCustomThemes);
  const [activeThemeId, setActiveThemeIdState] = useState<string>(readActiveThemeId);

  const themes = useMemo(
    () => [...BUILTIN_THEMES, ...customThemes],
    [customThemes]
  );

  const activeTheme = useMemo(
    () => themes.find((theme) => theme.id === activeThemeId) ?? darkTheme,
    [themes, activeThemeId]
  );

  useEffect(() => {
    applyThemeToDocument(activeTheme);
    window.localStorage.setItem(STORAGE_KEY_ACTIVE, activeTheme.id);
  }, [activeTheme]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(customThemes));
  }, [customThemes]);

  const isBuiltinTheme = (id: string) => BUILTIN_THEMES.some((theme) => theme.id === id);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themes,
      activeTheme,
      setActiveThemeId: setActiveThemeIdState,
      isBuiltinTheme,

      importTheme: async (file: File) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          throw new Error("Le fichier n'est pas un JSON valide.");
        }

        if (!isValidThemeDefinition(parsed)) {
          throw new Error("Structure de thème invalide ou incomplète.");
        }

        if (parsed.version > THEME_FORMAT_VERSION) {
          throw new Error(
            `Ce thème utilise une version de format (${parsed.version}) plus récente que celle supportée par cette version d'AetherVault Media (${THEME_FORMAT_VERSION}).`
          );
        }

        const id = isBuiltinTheme(parsed.id) ? `${parsed.id}-import-${Date.now()}` : parsed.id;
        const themeToAdd: ThemeDefinition = { ...parsed, id };

        setCustomThemes((current) => [
          ...current.filter((theme) => theme.id !== id),
          themeToAdd,
        ]);
        setActiveThemeIdState(id);
      },

      exportTheme: (id: string) => {
        const theme = themes.find((candidate) => candidate.id === id);
        if (!theme) return;

        const blob = new Blob([JSON.stringify(theme, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${theme.id}.aethervault-theme.json`;
        link.click();
        URL.revokeObjectURL(url);
      },

      removeCustomTheme: (id: string) => {
        if (isBuiltinTheme(id)) return;
        setCustomThemes((current) => current.filter((theme) => theme.id !== id));
        setActiveThemeIdState((current) => (current === id ? darkTheme.id : current));
      },
    }),
    [themes, activeTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme doit être utilisé à l'intérieur de <ThemeProvider>");
  }
  return ctx;
}
