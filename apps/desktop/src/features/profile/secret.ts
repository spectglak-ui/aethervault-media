/**
 * Secret d'un profil : mot de passe OU code PIN (0.7.9).
 * Les règles de validation reproduisent `security::profile_auth` côté Rust (qui
 * reste la source de vérité) pour répondre immédiatement, sans aller-retour.
 */
export type SecretKind = "password" | "pin";
/** Choix proposé dans les formulaires : « aucune protection » ou un des deux types. */
export type SecretMode = "none" | SecretKind;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

export function secretLabel(kind: SecretKind): string {
  return kind === "pin" ? "code PIN" : "mot de passe";
}

/** Type de secret d'un profil (`null` = sans protection). */
export function kindOfProfile(profile: {
  auth_kind?: string | null;
  password_hash?: string | null;
}): SecretKind | null {
  if (profile.auth_kind === "pin") return "pin";
  if (profile.auth_kind === "password" || profile.password_hash) return "password";
  return null;
}

/** Message d'erreur si le secret est refusé, sinon `null`. */
export function validateSecret(kind: SecretKind, value: string): string | null {
  if (kind === "pin") {
    if (!/^[0-9]*$/.test(value)) return "Le code PIN ne doit contenir que des chiffres.";
    if (value.length < PIN_MIN_LENGTH || value.length > PIN_MAX_LENGTH) {
      return `Le code PIN doit contenir entre ${PIN_MIN_LENGTH} et ${PIN_MAX_LENGTH} chiffres.`;
    }
    return null;
  }
  if (value.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (!/\p{Lu}/u.test(value)) return "Le mot de passe doit contenir au moins une lettre majuscule.";
  if (!/\p{Ll}/u.test(value)) return "Le mot de passe doit contenir au moins une lettre minuscule.";
  if (!/[0-9]/.test(value)) return "Le mot de passe doit contenir au moins un chiffre.";
  if (!/[^\p{L}\p{N}]/u.test(value)) return "Le mot de passe doit contenir au moins un caractère spécial.";
  return null;
}

export function secretHint(kind: SecretKind): string {
  return kind === "pin"
    ? `Entre ${PIN_MIN_LENGTH} et ${PIN_MAX_LENGTH} chiffres.`
    : "8 caractères minimum, avec une majuscule, une minuscule, un chiffre et un caractère spécial.";
}

export interface SecretFormState {
  mode: SecretMode;
  secret: string;
  confirm: string;
}

export const EMPTY_SECRET_FORM: SecretFormState = { mode: "none", secret: "", confirm: "" };

/** Message d'erreur du formulaire (secret absent, refusé, ou confirmation différente). */
export function validateSecretForm(form: SecretFormState): string | null {
  if (form.mode === "none") return null;
  if (!form.secret) return `Saisissez un ${secretLabel(form.mode)}.`;
  const problem = validateSecret(form.mode, form.secret);
  if (problem) return problem;
  if (form.secret !== form.confirm) {
    return `Les deux ${form.mode === "pin" ? "codes PIN" : "mots de passe"} ne correspondent pas.`;
  }
  return null;
}

/** Arguments à transmettre au backend (`null` = pas de secret). */
export function secretPayload(form: SecretFormState): { secret: string | null; kind: SecretKind | null } {
  return form.mode === "none"
    ? { secret: null, kind: null }
    : { secret: form.secret, kind: form.mode };
}
