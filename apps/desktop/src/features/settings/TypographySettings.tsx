import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type TypographySettings = { display: string; ui: string; body: string; mono: string };

const FONT_OPTIONS = [
  "Panchang",
  "Space Grotesk",
  "Manrope",
  "Inter",
  "Roboto",
  "JetBrains Mono",
  "system-ui",
];

const DEFAULTS: TypographySettings = {
  display: "Panchang",
  ui: "Panchang",
  body: "Space Grotesk",
  mono: "Space Grotesk",
};

/** Applique immédiatement les 4 familles via les variables CSS globales. */
function applyTypography(t: TypographySettings): void {
  const root = document.documentElement;
  root.style.setProperty("--font-display", `"${t.display}", system-ui, sans-serif`);
  root.style.setProperty("--font-ui", `"${t.ui}", system-ui, sans-serif`);
  root.style.setProperty("--font-body", `"${t.body}", system-ui, sans-serif`);
  root.style.setProperty("--font-mono", `"${t.mono}", ui-monospace, monospace`);
}

/** 0.5.4 — Section Paramètres « Typographie » : 4 familles remplaçables,
    application immédiate + persistance en base (app_settings). */
export function TypographySection() {
  const [settings, setSettings] = useState<TypographySettings>(DEFAULTS);

  useEffect(() => {
    invoke<TypographySettings>("get_typography_settings")
      .then((t) => {
        setSettings(t);
        applyTypography(t);
      })
      .catch(() => {});
  }, []);

  const update = (key: keyof TypographySettings, value: string) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    applyTypography(next);
    invoke("save_typography_settings", next).catch(() => {});
  };

  const rows: { key: keyof TypographySettings; label: string; hint: string }[] = [
    { key: "display", label: "Titres & hero", hint: "Grands titres de pages, fiches" },
    { key: "ui", label: "Interface", hint: "Boutons, badges, onglets, navigation" },
    { key: "body", label: "Corps de texte", hint: "Descriptions, synopsis, listes" },
    { key: "mono", label: "Technique", hint: "Timecodes, durées, résolutions" },
  ];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Typographie</h2>
      {rows.map((row) => (
        <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{row.label}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted, #9a9aa3)" }}>
              {row.hint}
            </div>
          </div>
          <select
            value={settings[row.key]}
            onChange={(e) => update(row.key, e.target.value)}
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.12)",
              background: "rgba(255,255,255,.06)",
              color: "#e8e8ec",
              fontSize: 12,
              // Chaque menu déroule la liste DANS sa propre police : aperçu direct.
              fontFamily: `"${settings[row.key]}", system-ui, sans-serif`,
            }}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f === "system-ui" ? "Système (défaut)" : f}
              </option>
            ))}
          </select>
        </div>
      ))}
      <p style={{ fontSize: 11, color: "var(--color-text-muted, #9a9aa3)", margin: 0 }}>
        Les changements s'appliquent immédiatement à toute l'application et sont
        mémorisés (base locale).
      </p>
    </section>
  );
}