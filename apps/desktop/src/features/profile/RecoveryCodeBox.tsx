import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import "./profileSecret.css";

interface RecoveryCodeBoxProps {
  code: string;
  onDone: () => void;
  /** Nom du compte concerné (affiché si plusieurs codes se suivent). */
  profileName?: string;
  variant?: "auth" | "form";
}

/**
 * Affiche UNE FOIS le code de récupération d'un compte et exige de confirmer qu'on
 * l'a noté : c'est la seule façon de récupérer l'accès si le secret est oublié.
 */
export function RecoveryCodeBox({ code, onDone, profileName, variant = "form" }: RecoveryCodeBoxProps) {
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* copie facultative */
    }
  };

  return (
    <div className="avm-secret__recovery">
      <h3 className="avm-secret__recovery-title">
        Code de récupération{profileName ? ` — ${profileName}` : ""}
      </h3>
      <p className={variant === "auth" ? "avm-auth__hint" : "avm-secret__hint"}>
        Conservez ce code précieusement : c'est la seule façon de récupérer l'accès si le mot de passe
        ou le code PIN est oublié. Il ne sera plus jamais affiché.
      </p>
      <div className="avm-secret__code">
        <code>{code}</code>
        <button type="button" className="avm-secret__copy" onClick={() => void copy()} aria-label="Copier">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <label className="avm-secret__ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        J'ai noté ce code en lieu sûr
      </label>
      {variant === "auth" ? (
        <button className="avm-btn avm-btn--primary" type="button" disabled={!ack} onClick={onDone}>
          Continuer
        </button>
      ) : (
        <Button type="button" variant="primary" disabled={!ack} onClick={onDone}>
          Continuer
        </Button>
      )}
    </div>
  );
}
