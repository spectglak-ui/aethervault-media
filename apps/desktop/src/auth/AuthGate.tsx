//! Gate d'authentification (Étape 6c) : intro animée (fond sombre + logo
//! centré + transition douce, skippable, reduced-motion respecté via
//! MotionConfig), puis soit l'assistant de premier démarrage (aucun
//! profil en base), soit la sélection de profil avec mot de passe
//! optionnel + récupération par code. Tant que le gate n'a pas rendu la
//! main, AUCUN provider métier ni route n'est monté : le shell ne peut
//! pas interroger de commandes métier sans profil actif.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Check, Copy, Lock, UserPlus } from "lucide-react";
import logoUrl from "../assets/logo.png";
import { applyNearMax } from "../window/nearMax";
import { metadataApi } from "../features/settings/api";
import "./auth.css";

interface LoginProfile {
  id: number;
  name: string;
  profile_type: string;
  password_hash: string | null;
}

interface LoginState {
  profiles: LoginProfile[];
  is_first_run: boolean;
}

const authApi = {
  getLoginState: () => invoke<LoginState>("get_login_state"),
  login: (profileId: number, password?: string, recoveryCode?: string) =>
    invoke<LoginProfile>("login_profile", {
      profileId,
      password: password ?? null,
      recoveryCode: recoveryCode ?? null,
    }),
  setupFirstAdmin: (name: string, password?: string) =>
    invoke<[LoginProfile, string | null]>("setup_first_admin", {
      name,
      password: password ?? null,
    }),
  createProfile: (name: string, profileType: string) =>
    invoke<LoginProfile>("create_profile", { name, profileType, permissions: null }),
  setProfilePassword: (profileId: number, password: string) =>
    invoke<string | null>("admin_reset_password", {
      targetProfileId: profileId,
      newPassword: password,
    }),
  recover: (profileId: number, recoveryCode: string, newPassword?: string) =>
    invoke<string | null>("recover_with_code", {
      profileId,
      recoveryCode,
      newPassword: newPassword ?? null,
    }),
};

const AVATAR_GRADIENTS: [string, string][] = [
  ["#f6a13c", "#e2574b"],
  ["#7c5cff", "#3aa6ff"],
  ["#22c48a", "#0ea5e9"],
  ["#ff6b9d", "#c86bff"],
  ["#facc15", "#84cc16"],
];

/** Lien vers la création de clé API TMDB (v3) — affiché avec bouton
copier dans le tuto de bienvenue (Étape 8). */
const TMDB_API_URL = "https://www.themoviedb.org/settings/api";

function avatarStyle(name: string): CSSProperties {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
  return { background: `linear-gradient(135deg, ${a}, ${b})` };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** Intro : fond sombre, halo discret, logo centré, nom en dessous.
~2,6 s, skippable d'un clic ou d'une touche. Les animations sont des
composants framer-motion : `MotionConfig reducedMotion="user"` (App)
les désactive automatiquement si l'OS le demande. */
function Intro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2600);
    window.addEventListener("keydown", onDone);
    window.addEventListener("pointerdown", onDone);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onDone);
      window.removeEventListener("pointerdown", onDone);
    };
  }, [onDone]);
  return (
    <motion.div
      className="avm-intro"
      exit={{ opacity: 0, transition: { duration: 0.5, ease: "easeInOut" } }}
    >
      <div className="avm-intro__halo" />
      <motion.img
        src={logoUrl}
        alt="AetherVault Media"
        className="avm-intro__logo"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      <motion.p
        className="avm-intro__name"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.6, ease: "easeOut" }}
      >
        AetherVault Media
      </motion.p>
    </motion.div>
  );
}

function Login({ profiles, onDone }: { profiles: LoginProfile[]; onDone: () => void }) {
  const [selected, setSelected] = useState<LoginProfile | null>(null);
  const [password, setPassword] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatars, setAvatars] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      profiles.map((p) =>
        invoke<string | null>("get_profile_avatar", { profileId: p.id })
          .then((path) => ({ id: p.id, url: path ? convertFileSrc(path) : null }))
          .catch(() => ({ id: p.id, url: null }))
      )
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<number, string> = {};
      for (const entry of entries) if (entry.url) map[entry.id] = entry.url;
      setAvatars(map);
    });
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (recovering) {
        await authApi.recover(selected.id, recoveryCode.trim(), newPassword || undefined);
      } else {
        await authApi.login(
          selected.id,
          selected.password_hash ? password : undefined
        );
      }
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avm-auth__card">
      {!selected ? (
        <>
          <h1 className="avm-auth__title">Qui êtes-vous ?</h1>
          <div className="avm-auth__profiles">
            {profiles.map((p) => (
              <button
                key={p.id}
                className="avm-auth__profile"
                onClick={() => {
                  setSelected(p);
                  setPassword("");
                  setError(null);
                  setRecovering(false);
                }}
              >
                <span className="avm-auth__avatar" style={avatarStyle(p.name)}>
                  {avatars[p.id] ? (
                    <img
                      src={avatars[p.id]}
                      alt=""
                      style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                    />
                  ) : (
                    initials(p.name)
                  )}
                  {p.password_hash && <Lock size={14} className="avm-auth__lock" />}
                </span>
                <span className="avm-auth__profile-name">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="avm-auth__form">
          <button
            type="button"
            className="avm-auth__back"
            onClick={() => {
              setSelected(null);
              setError(null);
            }}
          >
            <ArrowLeft size={14} /> Profils
          </button>
          <span className="avm-auth__avatar avm-auth__avatar--big" style={avatarStyle(selected.name)}>
            {avatars[selected.id] ? (
              <img
                src={avatars[selected.id]}
                alt=""
                style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
              />
            ) : (
              initials(selected.name)
            )}
          </span>
          <h2 className="avm-auth__subtitle">{selected.name}</h2>
          {recovering ? (
            <>
              <label className="avm-auth__label">
                Code de récupération
                <input
                  className="avm-auth__input"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  autoFocus
                />
              </label>
              <label className="avm-auth__label">
                Nouveau mot de passe (optionnel)
                <input
                  className="avm-auth__input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
            </>
          ) : (
            selected.password_hash && (
              <label className="avm-auth__label">
                Mot de passe
                <input
                  className="avm-auth__input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </label>
            )
          )}
          {error && <p className="avm-auth__error">{error}</p>}
          <div className="avm-auth__actions">
            <button className="avm-btn avm-btn--primary" type="submit" disabled={busy}>
              {recovering ? "Récupérer l'accès" : "Entrer"}
            </button>
            {selected.password_hash && !recovering && (
              <button
                className="avm-btn avm-btn--ghost"
                type="button"
                onClick={() => setRecovering(true)}
              >
                Mot de passe oublié ?
              </button>
            )}
            {recovering && (
              <button
                className="avm-btn avm-btn--ghost"
                type="button"
                onClick={() => setRecovering(false)}
              >
                Retour
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"admin" | "code" | "extra">("admin");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);
  const [extras, setExtras] = useState<LoginProfile[]>([]);
  const [extraName, setExtraName] = useState("");
  const [extraType, setExtraType] = useState("Utilisateur");
  const [extraPassword, setExtraPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitAdmin = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    if (password && password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [, code] = await authApi.setupFirstAdmin(name.trim(), password || undefined);
      if (code) {
        setRecoveryCode(code);
        setStep("code");
      } else {
        setStep("extra");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const addExtra = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !extraName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await authApi.createProfile(extraName.trim(), extraType);
      if (extraPassword) {
        await authApi.setProfilePassword(created.id, extraPassword);
      }
      setExtras((list) => [...list, created]);
      setExtraName("");
      setExtraPassword("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // best-effort
    }
  };

  return (
    <div className="avm-auth__card">
      {step === "admin" && (
        <form onSubmit={submitAdmin} className="avm-auth__form">
          <h1 className="avm-auth__title">Bienvenue — créez le compte administrateur</h1>
          <label className="avm-auth__label">
            Nom du compte
            <input
              className="avm-auth__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Administrateur"
              autoFocus
            />
          </label>
          <label className="avm-auth__label">
            Mot de passe (optionnel mais recommandé)
            <input
              className="avm-auth__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="avm-auth__label">
            Confirmer le mot de passe
            <input
              className="avm-auth__input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && <p className="avm-auth__error">{error}</p>}
          <div className="avm-auth__actions">
            <button className="avm-btn avm-btn--primary" type="submit" disabled={busy}>
              Continuer
            </button>
          </div>
        </form>
      )}
      {step === "code" && (
        <div className="avm-auth__form">
          <h1 className="avm-auth__title">Code de récupération</h1>
          <p className="avm-auth__hint">
            Conservez ce code précieusement : c'est la seule façon de récupérer
            l'accès si vous oubliez ce mot de passe. Il ne sera plus jamais affiché.
          </p>
          <div className="avm-auth__code">
            <code>{recoveryCode}</code>
            <button className="avm-btn avm-btn--ghost" type="button" onClick={() => void copyCode()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <label className="avm-auth__check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            J'ai noté ce code en lieu sûr
          </label>
          <div className="avm-auth__actions">
            <button
              className="avm-btn avm-btn--primary"
              type="button"
              disabled={!ack}
              onClick={() => setStep("extra")}
            >
              Continuer
            </button>
          </div>
        </div>
      )}
      {step === "extra" && (
        <div className="avm-auth__form">
          <h1 className="avm-auth__title">Ajouter d'autres comptes (optionnel)</h1>
          {extras.length > 0 && (
            <ul className="avm-auth__extra-list">
              {extras.map((p) => (
                <li key={p.id}>
                  {p.name} ({p.profile_type})
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addExtra} className="avm-auth__extra-form">
            <input
              className="avm-auth__input"
              value={extraName}
              onChange={(e) => setExtraName(e.target.value)}
              placeholder="Nom du compte"
            />
            <select
              className="avm-auth__input"
              value={extraType}
              onChange={(e) => setExtraType(e.target.value)}
            >
              <option>Utilisateur</option>
              <option>Invité</option>
              <option>Enfant</option>
              <option>Administrateur</option>
            </select>
            <input
              className="avm-auth__input"
              type="password"
              value={extraPassword}
              onChange={(e) => setExtraPassword(e.target.value)}
              placeholder="Mot de passe (optionnel)"
            />
            <button className="avm-btn avm-btn--ghost" type="submit" disabled={busy}>
              <UserPlus size={14} /> Ajouter
            </button>
          </form>
          {error && <p className="avm-auth__error">{error}</p>}
          <div className="avm-auth__actions">
            <button className="avm-btn avm-btn--primary" type="button" onClick={onDone}>
              Entrer dans l'application
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tuto de bienvenue TMDB (Étape 8) : affiché à chaque connexion si
 * aucune clé API n'est configurée. Si l'utilisateur clique "Passer",
 * la modale réapparaîtra à la prochaine connexion (pas de flag localStorage).
 * Si l'utilisateur enregistre une clé, la modale ne s'affichera plus. */
function TmdbWelcomeModal() {
  const [visible, setVisible] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Vérifie si une clé API TMDB est déjà configurée
    const checkApiKey = async () => {
      try {
        const api = metadataApi as unknown as {
          getTmdbApiKey?: () => Promise<string | null>;
          get?: () => Promise<{ tmdb_api_key?: string | null } | null>;
        };
        
        let key: string | null = null;
        if (typeof api.getTmdbApiKey === "function") {
          key = await api.getTmdbApiKey();
        } else if (typeof api.get === "function") {
          const s = await api.get();
          key = s?.tmdb_api_key ?? null;
        }
        
        // Affiche la modale uniquement si aucune clé n'est configurée
        if (!key) {
          setVisible(true);
        }
      } catch (err) {
        console.warn("[tmdb] vérification clé échouée :", err);
        // En cas d'erreur, ne pas bloquer l'utilisateur
      }
    };
    
    void checkApiKey();
  }, []);

  const close = () => {
    setVisible(false);
    // NE PAS poser de flag localStorage ici : la modale doit réapparaître
    // à la prochaine connexion si la clé n'est toujours pas renseignée
  };

  const save = async () => {
    if (!apiKey.trim()) {
      close();
      return;
    }
    setSaving(true);
    try {
      const api = metadataApi as unknown as {
        setTmdbApiKey?: (key: string) => Promise<unknown>;
        save?: (s: { tmdb_api_key: string }) => Promise<unknown>;
      };
      
      if (typeof api.setTmdbApiKey === "function") {
        await api.setTmdbApiKey(apiKey.trim());
      } else if (typeof api.save === "function") {
        await api.save({ tmdb_api_key: apiKey.trim() });
      }
      
      // Clé enregistrée avec succès : la modale ne s'affichera plus
      close();
    } catch (err) {
      console.error("[tmdb] sauvegarde clé échouée :", err);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!visible) return;

    // Focus initial sur l'input.
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 100);

    // Gestion Escape pour fermer.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };

    // Focus trap : Tab ne quitte pas la modale.
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !modalRef.current) return;
      const focusableElements = modalRef.current.querySelectorAll(
        'button, input, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length === 0) return;
      const first = focusableElements[0] as HTMLElement;
      const last = focusableElements[focusableElements.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keydown", handleTab);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleTab);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tmdb-welcome-title"
      aria-describedby="tmdb-welcome-desc"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        className="avm-tmdb-welcome-card"
        style={{
          background: "var(--color-surface, #1b1b21)",
          borderRadius: 12,
          padding: 32,
          maxWidth: 500,
          width: "90%",
        }}
      >
        <h1 id="tmdb-welcome-title" style={{ margin: "0 0 12px", fontSize: 20 }}>
          Bienvenue ! Activez les métadonnées automatiques
        </h1>
        <p
          id="tmdb-welcome-desc"
          style={{ marginTop: 0, fontSize: 14, color: "var(--color-text-muted, #9a9aa3)" }}
        >
          AetherVault Media peut récupérer automatiquement les affiches, synopsis et notes
          depuis TMDB pour enrichir votre médiathèque.
        </p>
        <input
          ref={inputRef}
          className="avm-auth__input"
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Collez votre clé API TMDB (optionnel)"
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          style={{
            width: "100%",
            padding: "10px 12px",
            marginTop: 16,
            border: "1px solid var(--color-border, #2c2c33)",
            borderRadius: 6,
            background: "var(--color-bg, #0f0f14)",
            color: "var(--color-text, #f2f2f5)",
            fontSize: 14,
          }}
        />
        <p style={{ fontSize: 12, color: "var(--color-text-muted, #9a9aa3)", marginTop: 8 }}>
          Obtenez une clé gratuite sur{" "}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--color-accent, #7c5cff)" }}
          >
            themoviedb.org
          </a>
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "flex-end" }}>
          <button
            onClick={close}
            style={{
              padding: "10px 20px",
              border: "1px solid var(--color-border, #2c2c33)",
              borderRadius: 6,
              background: "transparent",
              color: "var(--color-text, #f2f2f5)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Passer
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: 6,
              background: "var(--color-accent, #7c5cff)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Enregistrement…" : "Activer"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<"intro" | "gate">("intro");
  const [ready, setReady] = useState(false);
  const [loginState, setLoginState] = useState<LoginState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 0.3.0 : fenêtre « quasi-max » dès le démarrage (l'écran de connexion
  // s'affiche avant l'AppShell — l'effet doit donc vivre ici).
  useEffect(() => {
    void applyNearMax();
  }, []);

  useEffect(() => {
    let cancelled = false;
    authApi
      .getLoginState()
      .then((state) => {
        if (!cancelled) setLoginState(state);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finishIntro = useCallback(() => setStage("gate"), []);
  const authenticated = useCallback(() => setReady(true), []);

  if (ready)
    return (
      <>
        <TmdbWelcomeModal />
        {children}
      </>
    );

  return (
    <AnimatePresence mode="wait">
      {stage === "intro" ? (
        <Intro key="intro" onDone={finishIntro} />
      ) : (
        <motion.div
          key="gate"
          className="avm-auth"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
        >
          {loadError ? (
            <div className="avm-auth__card">
              <p className="avm-auth__error">{loadError}</p>
              <button className="avm-btn avm-btn--primary" onClick={() => window.location.reload()}>
                Réessayer
              </button>
            </div>
          ) : loginState === null ? (
            <div className="avm-auth__card">
              <p className="avm-auth__hint">Chargement…</p>
            </div>
          ) : loginState.is_first_run ? (
            <Onboarding onDone={authenticated} />
          ) : (
            <Login profiles={loginState.profiles} onDone={authenticated} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}