import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { Download, Upload } from "lucide-react";
import { Button, IconButton, PageHeader, useTheme } from "@aethervault/ui-kit";
import type { AppStatus, SecretKind, VaultStatus } from "@aethervault/shared-types";
import { THEME_FORMAT_VERSION } from "@aethervault/shared-types";
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
 * versionné et l'import/export local — est la fondation nécessaire à ce
 * partage, pas le partage lui-même.
 */
/** Image de profil (0.3.0) : choisit / retire l'avatar du profil actif.
L'image part en bytes vers le backend qui la copie dans le dossier
applicatif — aucun plugin de sélection de fichier requis. */
function ProfileAvatarSection() {
  const { activeProfile } = useActiveProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!activeProfile) return;
    invoke<string | null>("get_profile_avatar", { profileId: activeProfile.id })
      .then(setAvatar)
      .catch(() => {});
  }, [activeProfile]);
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeProfile) return;
    setBusy(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      await invoke("set_profile_avatar", {
        fileName: file.name,
        bytes: Array.from(new Uint8Array(buffer)),
      });
      setAvatar(
        await invoke<string | null>("get_profile_avatar", { profileId: activeProfile.id })
      );
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
      await invoke("clear_profile_avatar");
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
/** Fond d'Accueil personnalisé (0.3.0) : choisit / retire une image
appliquée en arrière-plan de l'Accueil (voile de lisibilité inclus). */
function HomeBackdropSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<string | null>("get_home_backdrop").then(setBackdrop).catch(() => {});
  }, []);
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      await invoke("set_home_backdrop", {
        fileName: file.name,
        bytes: Array.from(new Uint8Array(buffer)),
      });
      setBackdrop(await invoke<string | null>("get_home_backdrop"));
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
/** Auto-skip des génériques (0.3.0) : désactivé par défaut — sinon un
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
        Sauter automatiquement intros, génériques et résumés détectés
      </label>
      <p className="avm-settings-muted">
        Désactivé par défaut : un bouton « Passer l'intro / le générique » s'affiche
        pendant le segment. Marquage manuel via l'icône ciseaux du lecteur.
      </p>
    </section>
  );
}
function AppearanceSection() {
  const { themes, activeTheme, setActiveThemeId, importTheme, exportTheme, removeCustomTheme, isBuiltinTheme } =
    useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      await importTheme(file);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import impossible.");
    }
  };

  return (
    <section className="avm-settings-section">
      <h2>Apparence</h2>

      <ul className="avm-theme-list">
        {themes.map((theme) => (
          <li key={theme.id} className="avm-theme-list__item">
            <label className="avm-theme-list__label">
              <input
                type="radio"
                name="active-theme"
                checked={activeTheme.id === theme.id}
                onChange={() => setActiveThemeId(theme.id)}
              />
              <span
                className="avm-theme-list__swatch"
                style={{ background: theme.colors.accent }}
                aria-hidden="true"
              />
              {theme.name}
            </label>

            <div className="avm-theme-list__actions">
              <IconButton label={`Exporter ${theme.name}`} onClick={() => exportTheme(theme.id)}>
                <Download size={16} />
              </IconButton>
              {!isBuiltinTheme(theme.id) && (
                <IconButton
                  label={`Supprimer ${theme.name}`}
                  onClick={() => removeCustomTheme(theme.id)}
                >
                  ✕
                </IconButton>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="avm-theme-import">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="avm-visually-hidden"
          onChange={handleFileChange}
        />
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
          <Upload size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          Importer un thème
        </Button>
      </div>
      {importError && <p className="avm-settings-error">{importError}</p>}
    </section>
  );
}

/**
 * Changement du PIN/mot de passe du coffre privé (Étape 6a, doc §6.4 bis).
 * La création initiale et le déverrouillage se font depuis la catégorie
 * Privé (`PrivatePage`) — volontairement pas dupliqués ici, pour garder
 * une seule source de vérité par action. Réservé à `can_manage_global_settings`
 * : cette action affecte l'installation entière (voir `domain::privacy`).
 */
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
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Chargement impossible."));
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (newSecret !== confirmSecret) {
      setFormError("Les deux saisies ne correspondent pas.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setSuccess(false);
    try {
      await privacyApi.changeVaultSecret(secretKind, newSecret);
      setNewSecret("");
      setConfirmSecret("");
      setSuccess(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Changement impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="avm-settings-section">
      <h2>Sécurité</h2>

      {loadError && <p className="avm-settings-error">{loadError}</p>}

      {status && !status.initialized && (
        <div>
          <p className="avm-settings-muted">
            Aucun coffre privé n'a encore été créé pour cette installation.
          </p>
          <Button variant="secondary" onClick={() => navigate("/private")}>
            Créer le coffre privé
          </Button>
        </div>
      )}

      {status && status.initialized && !status.unlocked && (
        <p className="avm-settings-muted">
          Déverrouillez le coffre depuis la catégorie <strong>Privé</strong> pour pouvoir changer son
          PIN ou mot de passe.
        </p>
      )}

      {status && status.initialized && status.unlocked && (
        <form onSubmit={handleSubmit} className="avm-vault-form">
          <p className="avm-settings-muted">
            Un oubli du nouveau PIN/mot de passe rendra le coffre définitivement illisible, exactement
            comme à sa création.
          </p>

          <label className="avm-form-field">
            <span>Type de secret</span>
            <select value={secretKind} onChange={(event) => setSecretKind(event.target.value as SecretKind)}>
              <option value="pin">PIN (chiffres)</option>
              <option value="password">Mot de passe</option>
            </select>
          </label>

          <label className="avm-form-field">
            <span>Nouveau {secretKind === "pin" ? "PIN" : "mot de passe"}</span>
            <input
              type="password"
              inputMode={secretKind === "pin" ? "numeric" : "text"}
              value={newSecret}
              onChange={(event) => setNewSecret(event.target.value)}
            />
          </label>

          <label className="avm-form-field">
            <span>Confirmation</span>
            <input
              type="password"
              inputMode={secretKind === "pin" ? "numeric" : "text"}
              value={confirmSecret}
              onChange={(event) => setConfirmSecret(event.target.value)}
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

/**
 * Point d'entrée unique vers `/experimental-player` (voir
 * `ExperimentalPlayerPage.tsx`) — Phase 1 de la validation ciblée
 * `<video>` + MSE. Volontairement dans Paramètres plutôt que dans la
 * navigation principale : un outil de test, pas une fonctionnalité
 * destinée à un usage courant tant que la validation n'est pas conclue.
 */
function ExperimentalPlayerSection() {
  const navigate = useNavigate();

  return (
    <section className="avm-settings-section">
      <h2>Lecteur expérimental</h2>
      <p className="avm-settings-muted">
        Outil de test isolé, sans lien avec le lecteur principal : lit un fichier vidéo choisi
        manuellement via l'élément <code>&lt;video&gt;</code> natif du navigateur plutôt que via
        mpv, pour vérifier si la désynchronisation audio/vidéo constatée disparaît avec cette
        approche.
      </p>
      <Button variant="secondary" onClick={() => navigate("/experimental-player")}>
        Ouvrir le lecteur expérimental
      </Button>
    </section>
  );
}

/** Section « Métadonnées en ligne (TMDB) » (Étape 7) : clé API stockée
 * dans aethervault.db (non sensible), langue des fiches, enrichissement
 * automatique après scan. */
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
      .then((settings) => {
        setApiKey(settings.api_key);
        setLanguage(settings.language);
        setAutoEnrich(settings.auto_enrich);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Chargement impossible."));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await metadataApi.saveSettings({ api_key: apiKey, language, auto_enrich: autoEnrich });
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
      <form onSubmit={handleSubmit} className="avm-vault-form">
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
            <option value="fr-FR">Français (repli anglais si indisponible)</option>
            <option value="en-US">Anglais</option>
          </select>
        </label>
        <label className="avm-form-field">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
<input type="color"> ; repli neutre si format exotique. */
function toHex(color: string): string {
  const value = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
  }
  const rgbMatch = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `#${[r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  }
  return "#888888";
}

/** Couleurs du thème (0.3.0) : édite chaque variable de couleur du
thème actif puis enregistre le résultat comme thème personnalisé
(réutilise importTheme avec un File en mémoire — aucun nouveau
mécanisme, export/partage compatibles). */
function ThemeColorsSection() {
  const { activeTheme, importTheme } = useTheme();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Repart des couleurs du thème actif à chaque changement de thème.
  useEffect(() => {
    setEdited({ ...activeTheme.colors });
  }, [activeTheme]);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const definition = {
        version: THEME_FORMAT_VERSION,
        id: "custom-picker",
        name: "Mon thème personnalisé",
        colors: edited,
      };
      const file = new File([JSON.stringify(definition, null, 2)], "mon-theme.aethervault-theme.json", {
        type: "application/json",
      });
      await importTheme(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Application impossible.");
    } finally {
      setBusy(false);
    }
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
              value={toHex(value)}
              onChange={(e) => setEdited((cur) => ({ ...cur, [key]: e.target.value }))}
              style={{ width: 34, height: 26, border: "none", background: "none", cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.85rem" }}>{key}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <Button variant="primary" onClick={() => void apply()} disabled={busy}>
          Appliquer comme thème personnalisé
        </Button>
        <Button variant="ghost" onClick={() => setEdited({ ...activeTheme.colors })} disabled={busy}>
          Réinitialiser
        </Button>
      </div>
      {error && <p className="avm-settings-error">{error}</p>}
    </section>
  );
}
/** 0.4.1 : visibilité de la catégorie Privé sur l'accueil — option
déplacée ici depuis l'accueil (contrôle centralisé). */
function HomePrivateVisibilitySection() {
  const [hidePrivate, setHidePrivate] = useState(() => {
    try {
      return localStorage.getItem("avm-home-hide-private") === "1";
    } catch {
      return false;
    }
  });
  const toggle = (value: boolean) => {
    setHidePrivate(value);
    try {
      localStorage.setItem("avm-home-hide-private", value ? "1" : "0");
    } catch {
      // best-effort
    }
    window.dispatchEvent(new Event("avm-home-hide-private-changed"));
  };
  return (
    <section className="avm-settings-section">
      <h2>Accueil — catégorie Privé</h2>
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
export function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Paramètres"
        description="Apparence, sécurité du coffre privé et informations système."
      />
      <ProfileAvatarSection />
      <HomeBackdropSection />
      <HomePrivateVisibilitySection />
      <SkipSettingsSection />
      <AppearanceSection />
      <ThemeColorsSection />
      <TmdbSection />
      <SecuritySection />
      <ExperimentalPlayerSection />
      <SystemInfoSection />
    </div>
  );
}
