import { useEffect, useRef, useState } from "react";
import { Button, Slider } from "@aethervault/ui-kit";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, Trash2 } from "lucide-react";
import {
  addAnimatedBackdrops,
  getAnimatedBackdropLibrary,
  getSelectedId,
  removeAnimatedBackdrop,
  setSelectedId,
} from "../../lib/animatedBackdropLibrary";
import {
  armUiSounds,
  getUiSoundSettings,
  playUiSound,
  setUiSoundSettings,
  subscribeUiSoundSettings,
  type UiSoundId,
  type UiSoundSettings,
} from "../../features/sound/uiSounds";
import {
  getHeroTrailerEnabled,
  setHeroTrailerEnabled,
  subscribeHeroTrailerEnabled,
} from "../../features/trailer/heroTrailerSetting";
import {
  ACCENT_SWATCHES,
  DEFAULT_TRANSPARENT_COLORS,
  TRANSPARENT_PALETTES,
  applyTransparentColors,
  contrastRatio,
  currentTransparentColors,
  mixHex,
  resetTransparentColors,
  type TransparentColors,
} from "../../theme/transparentColors";
import { TRANSPARENT_THEME_VARS, writePersistedTheme } from "../../theme/persistedCustomTheme";
import "./settings-sections.css";

const SOUND_TESTS: { id: UiSoundId; label: string }[] = [
  { id: "tap-primary", label: "Clic" },
  { id: "toggle-on", label: "Interrupteur" },
  { id: "nav", label: "Navigation" },
  { id: "open", label: "Ouverture" },
  { id: "success", label: "Succès" },
  { id: "error", label: "Erreur" },
  { id: "notify", label: "Notification" },
  { id: "favorite", label: "Favori" },
  { id: "unlock", label: "Déverrouillage" },
  { id: "welcome", label: "Accueil" },
];

/** Paramètres → Sons de l'interface (0.7.8). */
export function UiSoundsSection() {
  const [settings, setSettings] = useState<UiSoundSettings>(() => getUiSoundSettings());
  const previewTimer = useRef<number | null>(null);
  useEffect(() => subscribeUiSoundSettings(setSettings), []);
  useEffect(() => () => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
  }, []);

  const update = (patch: Partial<UiSoundSettings>) => setSettings(setUiSoundSettings(patch));
  const onVolume = (percent: number) => {
    update({ volume: percent / 100 });
    // Aperçu du nouveau niveau, une fois le curseur posé.
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      armUiSounds();
      playUiSound("tap-primary");
    }, 160);
  };

  return (
    <section className="avm-settings-section">
      <h2>Sons de l'interface</h2>
      <p className="avm-settings-muted">
        De petits sons discrets et doux accompagnent vos actions : clics, interrupteurs, navigation,
        ouverture de fenêtres, confirmations. Ils sont automatiquement atténués pendant une lecture.
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        Activer les sons de l'interface
      </label>
      <div className="avm-volume-row">
        <span>Volume</span>
        <Slider
          value={Math.round(settings.volume * 100)}
          min={0}
          max={100}
          step={1}
          onChange={onVolume}
          ariaLabel="Volume des sons de l'interface"
        />
        <span className="avm-volume-row__value">{Math.round(settings.volume * 100)} %</span>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={settings.welcome}
          disabled={!settings.enabled}
          onChange={(e) => update({ welcome: e.target.checked })}
        />
        Signature sonore à la connexion
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={settings.hover}
          disabled={!settings.enabled}
          onChange={(e) => update({ hover: e.target.checked })}
        />
        Tic très discret au survol des boutons et des affiches
      </label>
      <div className="avm-sound-tests" role="group" aria-label="Écouter les sons">
        {SOUND_TESTS.map((test) => (
          <Button
            key={test.id}
            variant="secondary"
            data-sound="none"
            disabled={!settings.enabled}
            onClick={() => {
              armUiSounds();
              playUiSound(test.id);
            }}
          >
            {test.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

/** Paramètres → Bande-annonce dans le Héro de l'accueil (0.7.8). */
export function HeroTrailerSection() {
  const [enabled, setEnabled] = useState(() => getHeroTrailerEnabled());
  useEffect(() => subscribeHeroTrailerEnabled(setEnabled), []);
  return (
    <section className="avm-settings-section">
      <h2>Bandes annonces à l'accueil</h2>
      <p className="avm-settings-muted">
        Remplace l'image de bannière du titre à la une (le « Héro » de l'accueil) par sa bande-annonce,
        lue en boucle et sans le son — un bouton permet de l'activer. Si aucune bande-annonce n'est
        trouvée, la bannière habituelle reste affichée. Nécessite une connexion Internet : la vidéo est
        lue via YouTube, qui est alors contacté.
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setHeroTrailerEnabled(e.target.checked)}
        />
        Afficher la bande-annonce à la place de la bannière
      </label>
    </section>
  );
}

function ColorRow({
  label,
  color,
  onColor,
  opacity,
  onOpacity,
}: {
  label: string;
  color: string;
  onColor: (hex: string) => void;
  opacity?: number;
  onOpacity?: (value: number) => void;
}) {
  return (
    <>
      <span className="avm-tcolors__label">{label}</span>
      <input
        type="color"
        className="avm-tcolors__color"
        value={color}
        onChange={(e) => onColor(e.target.value)}
        aria-label={`Couleur : ${label}`}
      />
      {opacity !== undefined && onOpacity ? (
        <>
          <Slider
            value={Math.round(opacity * 100)}
            min={10}
            max={100}
            step={1}
            onChange={(v) => onOpacity(v / 100)}
            ariaLabel={`Opacité : ${label}`}
          />
          <span className="avm-tcolors__pct">{Math.round(opacity * 100)} %</span>
        </>
      ) : (
        <>
          <span />
          <span />
        </>
      )}
    </>
  );
}

/**
 * Paramètres → Thème transparent : couleurs de l'interface (0.7.8).
 * Teinte + opacité pour le fond, les panneaux et la barre latérale, couleur
 * d'accentuation, couleur du texte, ambiances prêtes à l'emploi. Tout s'applique
 * en direct et se conserve au redémarrage.
 */
export function TransparentThemeSection() {
  const [state, setState] = useState(() => currentTransparentColors());
  useEffect(() => {
    const refresh = () => setState(currentTransparentColors());
    window.addEventListener("avm-theme-changed", refresh);
    return () => window.removeEventListener("avm-theme-changed", refresh);
  }, []);

  const { active, preset, colors } = state;
  const change = (patch: Partial<TransparentColors>) => applyTransparentColors({ ...colors, ...patch });
  const activate = () => {
    writePersistedTheme({ preset: "transparent", vars: { ...TRANSPARENT_THEME_VARS } });
    const root = document.documentElement;
    for (const [key, value] of Object.entries(TRANSPARENT_THEME_VARS)) root.style.setProperty(key, value);
  };
  const samePalette = (c: TransparentColors) =>
    c.accent === colors.accent && c.background === colors.background && c.panels === colors.panels &&
    c.sidebar === colors.sidebar && c.text === colors.text;

  // Lisibilité : texte sur panneaux (couleurs opaques, hors transparence).
  const lowContrast = active && contrastRatio(colors.text, mixHex(colors.panels, colors.background, 0.5)) < 4.5;

  return (
    <section className="avm-settings-section">
      <h2>Thème transparent — couleurs de l'interface</h2>
      {!active ? (
        <>
          <p className="avm-settings-muted">
            Ces réglages s'appliquent au thème Transparent. Le thème actuel est « {preset} ».
          </p>
          <Button variant="secondary" onClick={activate}>
            Utiliser le thème Transparent
          </Button>
        </>
      ) : (
        <>
          <p className="avm-settings-muted">
            Choisissez une ambiance ou réglez chaque couleur : l'interface se met à jour en direct.
            L'opacité détermine ce que l'on voit du fond d'écran à travers les panneaux.
          </p>
          <div className="avm-tcolors__palettes" role="group" aria-label="Ambiances">
            {TRANSPARENT_PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`avm-tcolors__palette${samePalette(p.colors) ? " avm-tcolors__palette--on" : ""}`}
                onClick={() =>
                  applyTransparentColors({
                    ...p.colors,
                    // On garde les opacités choisies par l'utilisateur.
                    backgroundOpacity: colors.backgroundOpacity,
                    panelsOpacity: colors.panelsOpacity,
                    sidebarOpacity: colors.sidebarOpacity,
                  })
                }
              >
                <span className="avm-tcolors__dots" aria-hidden="true">
                  <i style={{ background: p.colors.accent }} />
                  <i style={{ background: p.colors.panels }} />
                  <i style={{ background: p.colors.background }} />
                </span>
                {p.label}
              </button>
            ))}
          </div>

          <div className="avm-tcolors__grid">
            <span className="avm-tcolors__label">Accentuation</span>
            <input
              type="color"
              className="avm-tcolors__color"
              value={colors.accent}
              onChange={(e) => change({ accent: e.target.value })}
              aria-label="Couleur d'accentuation"
            />
            <div className="avm-tcolors__swatches" role="group" aria-label="Accents proposés">
              {ACCENT_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`avm-tcolors__swatch${colors.accent === hex ? " avm-tcolors__swatch--on" : ""}`}
                  style={{ background: hex }}
                  onClick={() => change({ accent: hex })}
                  aria-label={`Accentuation ${hex}`}
                />
              ))}
            </div>
            <span />
            <ColorRow
              label="Fond de l'application"
              color={colors.background}
              onColor={(background) => change({ background })}
              opacity={colors.backgroundOpacity}
              onOpacity={(backgroundOpacity) => change({ backgroundOpacity })}
            />
            <ColorRow
              label="Panneaux et cartes"
              color={colors.panels}
              onColor={(panels) => change({ panels })}
              opacity={colors.panelsOpacity}
              onOpacity={(panelsOpacity) => change({ panelsOpacity })}
            />
            <ColorRow
              label="Barre latérale"
              color={colors.sidebar}
              onColor={(sidebar) => change({ sidebar })}
              opacity={colors.sidebarOpacity}
              onOpacity={(sidebarOpacity) => change({ sidebarOpacity })}
            />
            <ColorRow label="Texte" color={colors.text} onColor={(text) => change({ text })} />
          </div>
          {lowContrast && (
            <p className="avm-tcolors__warn" role="note">
              Le texte et les panneaux sont très proches : la lecture risque d'être difficile. Éclaircissez
              le texte ou assombrissez les panneaux.
            </p>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              resetTransparentColors();
            }}
            disabled={samePalette(DEFAULT_TRANSPARENT_COLORS) && colors.backgroundOpacity === DEFAULT_TRANSPARENT_COLORS.backgroundOpacity &&
              colors.panelsOpacity === DEFAULT_TRANSPARENT_COLORS.panelsOpacity && colors.sidebarOpacity === DEFAULT_TRANSPARENT_COLORS.sidebarOpacity}
          >
            Rétablir les couleurs d'origine
          </Button>
        </>
      )}
    </section>
  );
}

/**
Paramètres → Fond animé (panneau FUSIONNÉ, 0.8.0) : bibliothèque
personnelle de fonds animés. Vidéos locales (mp4, webm…) lues en
boucle, muettes, derrière toute l'interface ; la vidéo sélectionnée
ici est prioritaire sur les fonds intégrés et sur l'ancienne vidéo
personnelle. Rendu SANS <section> propre : ce bloc s'insère dans le
panneau « Fond animé » de SettingsPage.
*/
export function AnimatedBackdropLibrarySection() {
  const [library, setLibrary] = useState(getAnimatedBackdropLibrary);
  const [selected, setSelected] = useState<string | null>(getSelectedId);
  useEffect(() => {
    const refresh = () => {
      setLibrary(getAnimatedBackdropLibrary());
      setSelected(getSelectedId());
    };
    window.addEventListener("avm-home-backdrop-changed", refresh);
    return () => window.removeEventListener("avm-home-backdrop-changed", refresh);
  }, []);

  const pick = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Vidéo", extensions: ["mp4", "webm", "mov", "mkv"] }],
    });
    if (!picked) return;
    const paths = (Array.isArray(picked) ? picked : [picked]).map(String);
    setLibrary(addAnimatedBackdrops(paths));
  };

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: "18px 0 6px" }}>
        Bibliothèque personnelle
      </h3>
      <p className="avm-settings-muted">
        Ajoutez vos propres vidéos de fond : survolez une vignette pour l'animer, cliquez
        pour l'activer — elle devient prioritaire sur les fonds intégrés.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={() => void pick()}>
          <Plus size={14} /> Ajouter des vidéos…
        </Button>
        {selected !== null && (
          <Button variant="ghost" onClick={() => setSelectedId(null)}>
            Revenir aux fonds par défaut
          </Button>
        )}
      </div>
      {library.length === 0 ? (
        <p className="avm-settings-muted">Aucune vidéo personnelle pour l'instant.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {library.map((entry) => {
            const isOn = selected === entry.id;
            return (
              <div
                key={entry.id}
                style={{
                  border: `1px solid ${isOn ? "var(--color-accent, #7c5cff)" : "rgba(255,255,255,.08)"}`,
                  borderRadius: 12,
                  padding: 8,
                  background: isOn ? "rgba(124,92,255,.12)" : "rgba(255,255,255,.03)",
                }}
              >
                <video
                  src={convertFileSrc(entry.path)}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onClick={() => setSelectedId(entry.id)}
                  onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => e.currentTarget.pause()}
                  style={{
                    width: "100%",
                    aspectRatio: "16/9",
                    objectFit: "cover",
                    borderRadius: 8,
                    background: "#000",
                    cursor: "pointer",
                    display: "block",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      fontSize: 12.5,
                      fontWeight: isOn ? 700 : 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.name}
                  </button>
                  <Button
                    variant="ghost"
                    onClick={() => setLibrary(removeAnimatedBackdrop(entry.id))}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
                {isOn && (
                  <p style={{ fontSize: 11, color: "var(--color-accent, #7c5cff)", margin: "4px 0 0" }}>
                    Fond actif
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}