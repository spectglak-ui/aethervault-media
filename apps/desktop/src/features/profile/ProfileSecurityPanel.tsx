import { useState } from "react";
import { Button } from "@aethervault/ui-kit";
import type { Profile } from "@aethervault/shared-types";
import { useActiveProfile } from "../../profile/ActiveProfileContext";
import { profileApi } from "./api";
import { RecoveryCodeBox } from "./RecoveryCodeBox";
import { SecretFields } from "./SecretFields";
import {
  EMPTY_SECRET_FORM,
  kindOfProfile,
  secretLabel,
  secretPayload,
  validateSecretForm,
  type SecretFormState,
} from "./secret";
import "./profileSecret.css";

interface ProfileSecurityPanelProps {
  profile: Profile;
  /** `true` pour le compte connecté : le secret actuel est alors demandé. Sinon
   * (administrateur qui gère un autre compte) il est simplement réinitialisé. */
  isSelf: boolean;
  onChanged?: () => void;
}

/**
 * Définir, changer ou retirer le mot de passe / code PIN d'un compte, après sa
 * création. Un nouveau secret génère un nouveau code de récupération (l'ancien
 * n'est plus valable).
 */
export function ProfileSecurityPanel({ profile, isSelf, onChanged }: ProfileSecurityPanelProps) {
  const { refresh } = useActiveProfile();
  const currentKind = kindOfProfile(profile);
  const [form, setForm] = useState<SecretFormState>(EMPTY_SECRET_FORM);
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const removing = form.mode === "none";
  const needsCurrent = isSelf && currentKind !== null;

  const apply = async () => {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (removing && currentKind === null) {
      setError("Choisissez un mot de passe ou un code PIN.");
      return;
    }
    const problem = validateSecretForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    if (needsCurrent && !current) {
      setError(`Saisissez votre ${secretLabel(currentKind)} actuel.`);
      return;
    }
    setBusy(true);
    try {
      const { secret, kind } = secretPayload(form);
      const code = isSelf
        ? await profileApi.changeOwnSecret(needsCurrent ? current : null, secret, kind)
        : await profileApi.setSecret(profile.id, secret, kind);
      setForm(EMPTY_SECRET_FORM);
      setCurrent("");
      await refresh();
      onChanged?.();
      if (code) setRecoveryCode(code);
      else setNotice("Protection retirée : ce compte s'ouvre sans mot de passe.");
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "Échec de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCode) {
    return (
      <RecoveryCodeBox
        code={recoveryCode}
        profileName={profile.name}
        onDone={() => {
          setRecoveryCode(null);
          setNotice("Protection enregistrée.");
        }}
      />
    );
  }

  return (
    <div
      className="avm-secret__panel"
      onKeyDown={(e) => {
        // Entrée applique la protection sans valider le formulaire parent.
        if (e.key === "Enter") {
          e.preventDefault();
          void apply();
        }
      }}
    >
      <p className="avm-secret__status">
        {currentKind
          ? `Ce compte est protégé par un ${secretLabel(currentKind)}.`
          : "Aucune protection : tout le monde peut ouvrir ce compte."}
      </p>

      {needsCurrent && currentKind && (
        <label className="avm-form-field">
          <span>{currentKind === "pin" ? "Code PIN actuel" : "Mot de passe actuel"}</span>
          <input
            type="password"
            inputMode={currentKind === "pin" ? "numeric" : undefined}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
      )}

      <SecretFields value={form} onChange={setForm} allowNone={currentKind !== null} disabled={busy} />

      {error && <p className="avm-settings-error">{error}</p>}
      {notice && <p className="avm-secret__ok">{notice}</p>}

      <Button type="button" variant="secondary" disabled={busy} onClick={() => void apply()}>
        {busy
          ? "Enregistrement…"
          : removing
            ? "Retirer la protection"
            : currentKind
              ? "Modifier la protection"
              : "Activer la protection"}
      </Button>
    </div>
  );
}
