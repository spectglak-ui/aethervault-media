import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AppStatus, VaultStatus } from "@aethervault/shared-types";
import { Button, IconButton, PageHeader, useTheme } from "@aethervault/ui-kit";
import { useActiveProfile } from "../profile/ActiveProfileContext";
import { privacyApi } from "../features/privacy/api";
import "./pages.css";
import { metadataApi } from "../features/settings/api";

type DiagnosticsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: AppStatus };

/**
 * Sélection, import et export de thèmes. Le "partage communautaire" réel
 * (parcourir/télécharger les thèmes d'autres personnes en ligne) reste une
 * extension réseau future ; ce qui est implémenté ici — le format JSON
 * sérialisé et le bouton Import/Export — permet DÉJÀ à n'importe qui de
 * partager son thème (forums, Discord, Reddit...).
 */
const THEME_PRESETS: Record<string, Record<string, string>> = {
    dark: {
    "--color-bg": "#14161a",
    "--color-surface": "#1d2026",
    "--color-surface-hover": "#242830",
    "--color-border": "#2a2e37",
    "--color-accent": "#7c5cff",
    "--color-accent-hover": "#6a4de0",
    "--color-text": "#eef0f3",
    "--color-text-muted": "#9aa0ab",
    "--color-sidebar": "#101216",
    "--color-card": "#1d2026",
    "--color-danger": "#f28b82",
    "--color-success": "#6ee7a8",
    "--color-warning": "#f5c04e",
    "--sidebar-width": "260px",
    "--radius-sm": "6px",
    "--radius-md": "10px",
    "--radius-lg": "16px",
  },
  white: {
    "--color-bg": "#f5f6f8",
    "--color-surface": "#ffffff",
    "--color-surface-hover": "#eef0f4",
    "--color-border": "#e2e4e9",
    "--color-accent": "#7c5cff",
    "--color-accent-hover": "#6a4de0",
    "--color-text": "#14161a",
    "--color-text-muted": "#5b616c",
    "--color-sidebar": "#eceef2",
    "--color-card": "#ffffff",
    "--color-danger": "#c53d34",
    "--color-success": "#1f9d5c",
    "--color-warning": "#b97b12",
    "--sidebar-width": "260px",
    "--radius-sm": "6px",
    "--radius-md": "10px",
    "--radius-lg": "16px",
  },
  transparent: {
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
  },
  ocean: {
    "--color-bg": "#0a1628",
    "--color-surface": "#0f2035",
    "--color-surface-hover": "#142d4a",
    "--color-border": "rgba(100,170,255,.10)",
    "--color-accent": "#1e80ef",
    "--color-accent-hover": "#1668c7",
    "--color-text": "#e2e8f0",
    "--color-text-muted": "#7b93a8",
    "--color-sidebar": "#0d1a2d",
    "--color-card": "#0f2035",
    "--color-danger": "#ef4444",
    "--color-success": "#22c55e",
    "--color-warning": "#f59e0b",
    "--sidebar-width": "260px",
    "--radius-sm": "6px",
    "--radius-md": "10px",
    "--radius-lg": "16px",
  },
  cherry: {
    "--color-bg": "#1a0a10",
    "--color-surface": "#2a1018",
    "--color-surface-hover": "#3a1825",
    "--color-border": "rgba(255,100,150,.10)",
    "--color-accent": "#e8365d",
    "--color-accent-hover": "#c72d4f",
    "--color-text": "#f0e2e6",
    "--color-text-muted": "#a87b8b",
    "--color-sidebar": "#1f0c14",
    "--color-card": "#2a1018",
    "--color-danger": "#ef4444",
    "--color-success": "#22c55e",
    "--color-warning": "#f59e0b",
    "--sidebar-width": "260px",
    "--radius-sm": "6px",
    "--radius-md": "10px",
    "--radius-lg": "16px",
  },
  forest: {
    "--color-bg": "#0a1a10",
    "--color-surface": "#102a18",
    "--color-surface-hover": "#183a25",
    "--color-border": "rgba(100,255,150,.10)",
    "--color-accent": "#36e86d",
    "--color-accent-hover": "#2dc75a",
    "--color-text": "#e2f0e6",
    "--color-text-muted": "#7ba88b",
    "--color-sidebar": "#0c1f12",
    "--color-card": "#102a18",
    "--color-danger": "#ef4444",
    "--color-success": "#22c55e",
    "--color-warning": "#f59e0b",
    "--sidebar-width": "260px",
    "--radius-sm": "6px",
    "--radius-md": "10px",
    "--radius-lg": "16px",
  },
  sunset: {
    "--color-bg": "#1a120a",
    "--color-surface": "#2a1a10",
    "--color-surface-hover": "#3a2518",
    "--color-border": "rgba(255,180,100,.10)",
    "--color-accent": "#e89036",
    "--color-accent-hover": "#c77a2d",
    "--color-text": "#f0e8e2",
    "--color-text-muted": "#a8937b",
    "--color-sidebar": "#1f160c",
    "--color-card": "#2a1a10",
    "--color-danger": "#ef4444",
    "--color-success": "#22c55e",
    "--color-warning": "#f59e0b",
    "--sidebar-width": "260px",
    "--radius-sm": "6px",
    "--radius-md": "10px",
    "--radius-lg": "16px",
  },
};

/* ------------------------------------------------------------------ */
/*  Sections individuelles                                            */
/* ------------------------------------------------------------------ */

function ProfileAvatarSection() {
  const { activeProfile } = useActiveProfile();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeProfile) return;
    invoke<string | null>("get_profile_avatar", { profileId: activeProfile.id })
      .then(setAvatar)
      .catch(() => setAvatar(null));
  }, [activeProfile]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      await invoke("set_profile_avatar", {
        profileId: activeProfile!.id,
        fileName: file.name,
        bytes,
      });
      const refreshed = await invoke<string | null>("get_profile_avatar", {
        profileId: activeProfile!.id,
      });
      setAvatar(refreshed);
      window.dispatchEvent(new Event("avm-avatar-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("clear_profile_avatar", { profileId: activeProfile!.id });
      setAvatar(null);
      window.dispatchEvent(new Event("avm-avatar-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="avm-settings-section">
      <h2>Image de profil</h2>
      <p className="avm-settings-muted">
        Personnalise l'avatar du compte actif (écran de connexion et barre du haut).
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="avm-visually-hidden"
        onChange={(e) => void handleFile(e)}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {avatar && (
          <img
            src={convertFileSrc(avatar)}
            alt="Avatar actuel"
            style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }}
          />
        )}
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          Choisir une image
        </Button>
        {avatar && (
          <Button variant="ghost" onClick={() => void handleClear()} disabled={busy}>
            Retirer
          </Button>
        )}
      </div>
      {error && <p className="avm-settings-error">{error}</p>}
    </section>
  );
}

function HomeBackdropSection() {
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<string | null>("get_home_backdrop")
      .then(setBackdrop)
      .catch(() => setBackdrop(null));
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      await invoke("set_home_backdrop", { fileName: file.name, bytes });
      const refreshed = await invoke<string | null>("get_home_backdrop");
      setBackdrop(refreshed);
      window.dispatchEvent(new Event("avm-home-backdrop-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("clear_home_backdrop");
      setBackdrop(null);
      window.dispatchEvent(new Event("avm-home-backdrop-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="avm-settings-section">
      <h2>Fond de la page d'accueil</h2>
      <p className="avm-settings-muted">
        Image personnelle en arrière-plan de l'Accueil, assombrie pour garder les cartes lisibles.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="avm-visually-hidden"
        onChange={(e) => void handleFile(e)}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {backdrop && (
          <img
            src={convertFileSrc(backdrop)}
            alt="Fond actuel"
            style={{ width: 96, height: 54, objectFit: "cover", borderRadius: 6 }}
          />
        )}
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          Choisir une image
        </Button>
        {backdrop && (
          <Button variant="ghost" onClick={() => void handleClear()} disabled={busy}>
            Retirer
          </Button>
        )}
      </div>
      {error && <p className="avm-settings-error">{error}</p>}
    </section>
  );
}

/* Auto-skip des génériques (0.3.0) : désactivé par défaut — sinon un
   bouton « Passer » s'affiche pendant chaque segment détecté/marqué. */
function SkipSettingsSection() {
  const [autoSkip, setAutoSkip] = useState(() => {
    try {
      return localStorage.getItem("avm-autoskip") === "1";
    } catch {
      return false;
    }
  });
  const toggle = (value: boolean) => {
    setAutoSkip(value);
    try {
      localStorage.setItem("avm-autoskip", value ? "1" : "0");
    } catch {
      // best-effort
    }
    window.dispatchEvent(new Event("avm-autoskip-changed"));
  };
  return (
    <section className="avm-settings-section">
      <h2>Lecture — génériques</h2>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={autoSkip} onChange={(e) => toggle(e.target.checked)} />
        Passer automatiquement les intros et génériques de fin
      </label>
      <p className="avm-settings-muted">
        Quand cette option est activée, les segments « intro » et « outro » détectés ou marqués
        manuellement sont automatiquement sautés pendant la lecture.
      </p>
    </section>
  );
}

type SecretKind = "pin" | "password";

/** Section « Sécurité — Coffre privé ». Réglages sensibles (mode opaque, WAL
    sécurisé, etc.) : cette action affecte l'installation entière. */
function SecuritySection() {
  const { activeProfile } = useActiveProfile();
  const navigate = useNavigate();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [secretKind, setSecretKind] = useState<SecretKind>("pin");
  const [newSecret, setNewSecret] = useState("");
  const [confirmSecret, setConfirmSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canManage = activeProfile?.can_manage_global_settings ?? false;

  useEffect(() => {
    if (!canManage) return;
    privacyApi
      .getVaultStatus()
      .then(setStatus)
      .catch((error) =>
        setLoadError(error instanceof Error ? error.message : "Chargement impossible.")
      );
  }, [canManage]);

  if (!canManage) {
    return (
      <section className="avm-settings-section">
        <h2>Sécurité</h2>
        <p className="avm-settings-muted">
          Réservé à un profil disposant de la permission de gestion des paramètres globaux.
        </p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="avm-settings-section">
        <h2>Sécurité</h2>
        <p className="avm-settings-error">{loadError}</p>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="avm-settings-section">
        <h2>Sécurité</h2>
        <p>Chargement…</p>
      </section>
    );
  }

  if (!status.initialized) {
    return (
      <section className="avm-settings-section">
        <h2>Sécurité</h2>
        <p className="avm-settings-muted">
          Le coffre privé n'est pas encore configuré.
        </p>
        <Button variant="primary" onClick={() => navigate("/privacy")}>
          Configurer le coffre
        </Button>
      </section>
    );
  }

  const handleChangeSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(false);
    if (newSecret.length < 4) {
      setFormError("Le secret doit contenir au moins 4 caractères.");
      return;
    }
    if (newSecret !== confirmSecret) {
      setFormError("Les deux champs ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    try {
      await invoke("change_vault_secret", { newSecret: newSecret });
      setNewSecret("");
      setConfirmSecret("");
      setSuccess(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur lors du changement.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="avm-settings-section">
      <h2>Sécurité — Coffre privé</h2>
      <p className="avm-settings-muted">
        Changer le secret (PIN ou mot de passe) du coffre privé. Le coffre doit être déverrouillé.
      </p>
      {status.locked ? (
        <p className="avm-settings-muted">
          Le coffre est verrouillé. Déverrouillez-le d'abord pour changer le secret.
        </p>
      ) : (
        <form onSubmit={(e) => void handleChangeSecret(e)} className="avm-vault-form">
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="secretKind"
                checked={secretKind === "pin"}
                onChange={() => setSecretKind("pin")}
              />
              PIN
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="secretKind"
                checked={secretKind === "password"}
                onChange={() => setSecretKind("password")}
              />
              Mot de passe
            </label>
          </div>
          <label className="avm-form-field">
            <span>Nouveau {secretKind === "pin" ? "PIN" : "mot de passe"}</span>
            <input
              type={secretKind === "pin" ? "tel" : "password"}
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              placeholder={secretKind === "pin" ? "1234" : "••••••••"}
              autoComplete="new-password"
            />
          </label>
          <label className="avm-form-field">
            <span>Confirmer</span>
            <input
              type={secretKind === "pin" ? "tel" : "password"}
              value={confirmSecret}
              onChange={(e) => setConfirmSecret(e.target.value)}
              placeholder="Retapez le même"
              autoComplete="new-password"
            />
          </label>
          {formError && <p className="avm-settings-error">{formError}</p>}
          {success && <p className="avm-settings-success">Secret du coffre mis à jour.</p>}
          <div className="avm-form-actions">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Enregistrement…" : "Changer le secret"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function SystemInfoSection() {
  const [state, setState] = useState<DiagnosticsState>({ kind: "loading" });

  useEffect(() => {
    invoke<AppStatus>("get_app_status")
      .then((status) => setState({ kind: "ready", status }))
      .catch((error) => setState({ kind: "error", message: String(error) }));
  }, []);

  return (
    <section className="avm-settings-section">
      <h2>Informations système</h2>
      {state.kind === "loading" && <p>Chargement…</p>}
      {state.kind === "error" && <p className="avm-settings-error">{state.message}</p>}
      {state.kind === "ready" && (
        <dl className="avm-settings-diagnostics">
          <dt>Version</dt>
          <dd>{state.status.version}</dd>
          <dt>Base de données</dt>
          <dd className="avm-mono">{state.status.database_path}</dd>
          <dt>Répertoire de logs</dt>
          <dd className="avm-mono">{state.status.log_directory}</dd>
          <dt>Profils enregistrés</dt>
          <dd>{state.status.profile_count}</dd>
        </dl>
      )}
    </section>
  );
}

function ExperimentalPlayerSection() {
  return (
    <section className="avm-settings-section">
      <h2>Lecteur expérimental</h2>
      <p className="avm-settings-muted">
        Ouvre une seconde fenêtre de lecture (moteur mpv natif) pour les tests internes.
      </p>
      <Button variant="secondary" onClick={() => void invoke("open_player_window")}>
        Ouvrir le lecteur expérimental
      </Button>
    </section>
  );
}

/** Section « Métadonnées en ligne (TMDB) » (Étape 7) : clé API stockée
    dans aethervault.db (non sensible), langue des fiches, enrichissement
    automatique après scan. */
function TmdbSection() {
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState("fr-FR");
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    metadataApi
      .getSettings()
      .then((s) => {
        setApiKey(s.api_key);
        setLanguage(s.language);
        setAutoEnrich(s.auto_enrich);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await metadataApi.saveSettings({
        api_key: apiKey,
        language,
        auto_enrich: autoEnrich,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="avm-settings-section">
      <h2>Métadonnées en ligne (TMDB)</h2>
      <form onSubmit={(e) => void handleSubmit(e)} className="avm-vault-form">
        <p className="avm-settings-muted">
          Enrichit automatiquement les fiches (synopsis, genres, casting, affiches) via TMDB,
          comme Jellyfin. La clé reste sur cette machine.
        </p>
        <label className="avm-form-field">
          <span>Clé API TMDB (v3)</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Collez votre clé API"
          />
        </label>
        <label className="avm-form-field">
          <span>Langue des fiches</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="fr-FR">Français</option>
            <option value="en-US">English</option>
            <option value="de-DE">Deutsch</option>
            <option value="es-ES">Español</option>
            <option value="it-IT">Italiano</option>
            <option value="pt-BR">Português</option>
            <option value="ja-JP">日本語</option>
          </select>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={autoEnrich}
              onChange={(event) => setAutoEnrich(event.target.checked)}
            />
            Enrichir automatiquement après chaque scan
          </span>
        </label>
        {error && <p className="avm-settings-error">{error}</p>}
        {saved && <p className="avm-settings-success">Paramètres TMDB enregistrés.</p>}
        <div className="avm-form-actions">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Convertit une couleur CSS (#rgb, #rrggbb, rgb()) en #rrggbb pour
    <input type="color"> ; repli neutre si format non reconnu. */
function cssToHex(css: string): string {
  const s = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const hex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  return "#7c5cff";
}

function ThemeCustomizerSection() {
  const [currentPreset, setCurrentPreset] = useState("default");
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const initial: Record<string, string> = {};
    for (const key of Object.keys(THEME_PRESETS.ocean)) {
      initial[key] = style.getPropertyValue(key).trim() || THEME_PRESETS.ocean[key];
    }
    setEdited(initial);
  }, []);

  const applyVars = (vars: Record<string, string>) => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
  };

  const selectPreset = (name: string) => {
    setCurrentPreset(name);
    const vars = THEME_PRESETS[name];
    if (name === "default") {
      const root = document.documentElement;
      for (const key of Object.keys(edited)) {
        root.style.removeProperty(key);
      }
      const style = getComputedStyle(root);
      const fresh: Record<string, string> = {};
      for (const key of Object.keys(THEME_PRESETS.ocean)) {
        fresh[key] = style.getPropertyValue(key).trim() || "";
      }
      setEdited(fresh);
    } else {
      applyVars(vars);
      setEdited({ ...vars });
    }
  };

  const updateVar = (key: string, value: string) => {
    const next = { ...edited, [key]: value };
    setEdited(next);
    document.documentElement.style.setProperty(key, value);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(edited, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aethervault-theme.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const text = await file.text();
        const vars = JSON.parse(text) as Record<string, string>;
        applyVars(vars);
        setEdited(vars);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Application impossible.");
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  return (
    <section className="avm-settings-section">
      <h2>Couleurs du thème</h2>
      <p className="avm-settings-muted">
        Personnalise chaque couleur du thème actif, puis enregistre le résultat comme
        thème personnalisé « Mon thème personnalisé ».
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {Object.entries(edited).map(([key, value]) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="color"
              value={cssToHex(value)}
              onChange={(e) => updateVar(key, e.target.value)}
              style={{ width: 28, height: 28, border: "none", background: "none", cursor: "pointer" }}
            />
            <span style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)" }}>{key}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {Object.keys(THEME_PRESETS).map((name) => (
          <Button
            key={name}
            variant={currentPreset === name ? "primary" : "secondary"}
            onClick={() => selectPreset(name)}
          >
            {name === "default" ? "Par défaut" : name.charAt(0).toUpperCase() + name.slice(1)}
          </Button>
        ))}
        <Button variant="secondary" onClick={handleExport}>
          Exporter
        </Button>
        <Button variant="secondary" onClick={() => void handleImport()} disabled={busy}>
          Importer
        </Button>
      </div>
      {error && <p className="avm-settings-error">{error}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  0.5.4 — Section « Typographie » (polices personnalisables)        */
/* ------------------------------------------------------------------ */

const FONT_OPTIONS = [
  "Panchang",
  "Space Grotesk",
  "Manrope",
  "Inter",
  "Roboto",
  "JetBrains Mono",
  "system-ui",
];

type TypographySettings = { display: string; ui: string; body: string; mono: string };

const TYPO_DEFAULTS: TypographySettings = {
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

function TypographySection() {
  const [settings, setSettings] = useState<TypographySettings>(TYPO_DEFAULTS);

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
    { key: "display", label: "Titres & hero", hint: "Grands titres de pages, fiches, hero" },
    { key: "ui", label: "Interface", hint: "Boutons, badges, onglets, navigation" },
    { key: "body", label: "Corps de texte", hint: "Descriptions, synopsis, listes" },
    { key: "mono", label: "Technique", hint: "Timecodes, durées, résolutions" },
  ];

  return (
    <section className="avm-settings-section">
      <h2>Typographie</h2>
      <p className="avm-settings-muted">
        Personnalise les polices utilisées dans l'application. Les changements
        s'appliquent immédiatement et sont mémorisés.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
      </div>
    </section>
  );
}

function HidePrivateSection() {
  const [hidePrivate, setHidePrivate] = useState(() => {
    try {
      return localStorage.getItem("avm-hide-private") === "1";
    } catch {
      return false;
    }
  });

  const toggle = (value: boolean) => {
    setHidePrivate(value);
    try {
      localStorage.setItem("avm-hide-private", value ? "1" : "0");
    } catch {
      // best-effort
    }
    window.dispatchEvent(new Event("avm-hide-private-changed"));
  };

  return (
    <section className="avm-settings-section">
      <h2>Visibilité — Catégorie Privé</h2>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={hidePrivate} onChange={(e) => toggle(e.target.checked)} />
        Masquer la catégorie Privé de la page d'accueil
      </label>
      <p className="avm-settings-muted">
        La catégorie Privé reste accessible depuis la barre latérale ; cette option
        retire seulement sa tuile de l'accueil.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Paramètres (assemblage)                                      */
/* ------------------------------------------------------------------ */

export function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Paramètres"
        description="Apparence, sécurité du coffre privé et informations système."
      />
      <ProfileAvatarSection />
      <HomeBackdropSection />
      <ThemeCustomizerSection />
      <TypographySection />
      <SkipSettingsSection />
      <TmdbSection />
      <HidePrivateSection />
      <SecuritySection />
      <ExperimentalPlayerSection />
      <SystemInfoSection />
    </div>
  );
}