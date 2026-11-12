import { useId } from "react";
import { secretHint, type SecretFormState, type SecretMode } from "./secret";
import "./profileSecret.css";

interface SecretFieldsProps {
  value: SecretFormState;
  onChange: (next: SecretFormState) => void;
  /** Style des champs : écrans d'authentification ou formulaires classiques. */
  variant?: "auth" | "form";
  /** Propose « Aucune protection » (désactivé quand un secret est obligatoire). */
  allowNone?: boolean;
  disabled?: boolean;
}

const MODES: { mode: SecretMode; label: string }[] = [
  { mode: "none", label: "Aucune protection" },
  { mode: "password", label: "Mot de passe" },
  { mode: "pin", label: "Code PIN" },
];

/**
 * Choix de la protection d'un compte : aucune, mot de passe ou code PIN
 * (4 à 8 chiffres), avec confirmation. Un PIN n'accepte que des chiffres.
 */
export function SecretFields({
  value,
  onChange,
  variant = "form",
  allowNone = true,
  disabled = false,
}: SecretFieldsProps) {
  const group = useId();
  const isPin = value.mode === "pin";
  const labelClass = variant === "auth" ? "avm-auth__label" : "avm-form-field";
  const inputClass = variant === "auth" ? "avm-auth__input" : undefined;
  const cleaned = (raw: string) => (isPin ? raw.replace(/\D/g, "").slice(0, 8) : raw);

  return (
    <div className="avm-secret">
      <div className="avm-secret__modes" role="radiogroup" aria-label="Protection du compte">
        {MODES.filter((m) => allowNone || m.mode !== "none").map((m) => (
          <label
            key={m.mode}
            className={`avm-secret__mode${value.mode === m.mode ? " avm-secret__mode--active" : ""}`}
          >
            <input
              type="radio"
              name={group}
              checked={value.mode === m.mode}
              disabled={disabled}
              onChange={() => onChange({ mode: m.mode, secret: "", confirm: "" })}
            />
            {m.label}
          </label>
        ))}
      </div>

      {value.mode !== "none" && (
        <>
          <label className={labelClass}>
            <span>{isPin ? "Code PIN" : "Mot de passe"}</span>
            <input
              className={inputClass}
              type="password"
              inputMode={isPin ? "numeric" : undefined}
              autoComplete="new-password"
              maxLength={isPin ? 8 : undefined}
              value={value.secret}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, secret: cleaned(e.target.value) })}
            />
          </label>
          <label className={labelClass}>
            <span>{isPin ? "Confirmer le code PIN" : "Confirmer le mot de passe"}</span>
            <input
              className={inputClass}
              type="password"
              inputMode={isPin ? "numeric" : undefined}
              autoComplete="new-password"
              maxLength={isPin ? 8 : undefined}
              value={value.confirm}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, confirm: cleaned(e.target.value) })}
            />
          </label>
          <p className="avm-secret__hint">{secretHint(value.mode)}</p>
        </>
      )}
    </div>
  );
}
