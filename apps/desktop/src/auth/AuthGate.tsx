//! Gate d'authentification (Étape 6c) : intro animée (fond sombre + logo
//! centré + transition douce, skippable, reduced-motion respecté via
//! MotionConfig), puis soit l'assistant de premier démarrage (aucun
//! profil en base), soit la sélection de profil avec mot de passe
//! optionnel + récupération par code. Tant que le gate n'a pas rendu la
//! main, AUCUN provider métier ni route n'est monté : le shell ne peut
//! pas interroger de commandes métier sans profil actif.
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Check, Copy, Lock, UserPlus } from "lucide-react";
import logoUrl from "../assets/logo.png";
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
 * ~2,6 s, skippable d'un clic ou d'une touche. Les animations sont des
 * composants framer-motion : `MotionConfig reducedMotion="user"` (App)
 * les désactive automatiquement si l'OS le demande. */
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
                  {initials(p.name)}
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
            {initials(selected.name)}
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

export function AuthGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<"intro" | "gate">("intro");
  const [ready, setReady] = useState(false);
  const [loginState, setLoginState] = useState<LoginState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  if (ready) return <>{children}</>;

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