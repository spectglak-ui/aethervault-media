import { useEffect, useState } from "react";
import { Copy, Check, UserPlus } from "lucide-react";
import { Button, Modal } from "@aethervault/ui-kit";
import { friendsApi, type RemoteFriend } from "./api";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

/**
 * Modal « Code ami » : deux onglets — « Mon code » (à partager) et
 * « Entrer un code » (pour appairer un ami distant).
 */
export function FriendCodeModal({ open, onClose, onAdded }: Props) {
  const [tab, setTab] = useState<"mine" | "enter">("mine");
  const [myCode, setMyCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [enterCode, setEnterCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGenerating(true);
    setMyCode(null);
    setError(null);
    setEnterCode("");
    friendsApi
      .generateCode()
      .then(setMyCode)
      .catch((e) => setError(e instanceof Error ? e.message : "Génération impossible."))
      .finally(() => setGenerating(false));
  }, [open]);

  const handleCopy = async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback : sélection manuelle
    }
  };

  const handleAdd = async () => {
    if (!enterCode.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const f: RemoteFriend = await friendsApi.addByCode(enterCode.trim());
      onAdded();
      onClose();
      console.log("[friends] ami distant ajouté :", f.peer_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Appairage impossible.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Code ami distant">
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setTab("mine")}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            font: "inherit",
            background: tab === "mine" ? "var(--color-accent, #7c5cff)" : "var(--color-bg, #0f0f14)",
            color: tab === "mine" ? "#fff" : "var(--color-text-muted, #9a9aa3)",
          }}
        >
          Mon code
        </button>
        <button
          type="button"
          onClick={() => setTab("enter")}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            font: "inherit",
            background: tab === "enter" ? "var(--color-accent, #7c5cff)" : "var(--color-bg, #0f0f14)",
            color: tab === "enter" ? "#fff" : "var(--color-text-muted, #9a9aa3)",
          }}
        >
          Entrer un code
        </button>
      </div>

      {tab === "mine" && (
        <div>
          <p style={{ marginTop: 0, fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            Partage ce code avec un autre utilisateur d'AetherVault Media pour
            l'ajouter comme ami distant.
          </p>
          <div
            style={{
              padding: 12,
              background: "var(--color-bg, #0f0f14)",
              border: "1px solid var(--color-border, #2c2c33)",
              borderRadius: 8,
              fontFamily: "monospace",
              fontSize: 11,
              wordBreak: "break-all",
              color: "var(--color-accent, #7c5cff)",
              minHeight: 60,
            }}
          >
            {generating ? "Génération…" : myCode ?? "—"}
          </div>
          {myCode && (
            <Button
              variant="secondary"
              onClick={handleCopy}
              style={{ marginTop: 8, width: "100%" }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span style={{ marginLeft: 6 }}>
                {copied ? "Copié !" : "Copier le code"}
              </span>
            </Button>
          )}
        </div>
      )}

      {tab === "enter" && (
        <div>
          <p style={{ marginTop: 0, fontSize: 13, color: "var(--color-text-muted, #9a9aa3)" }}>
            Colle le code que ton ami t'a envoyé pour l'ajouter.
          </p>
          <textarea
            value={enterCode}
            onChange={(e) => setEnterCode(e.target.value)}
            placeholder="AVM1-..."
            rows={3}
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid var(--color-border, #2c2c33)",
              borderRadius: 8,
              background: "var(--color-bg, #0f0f14)",
              color: "var(--color-text, #f2f2f5)",
              fontFamily: "monospace",
              fontSize: 12,
              resize: "vertical",
            }}
          />
          <Button
            variant="primary"
            onClick={handleAdd}
            disabled={adding || !enterCode.trim()}
            style={{ marginTop: 8, width: "100%" }}
          >
            <UserPlus size={14} style={{ marginRight: 6 }} />
            {adding ? "Appairage…" : "Ajouter cet ami"}
          </Button>
        </div>
      )}

      {error && (
        <p style={{ color: "#ff6464", fontSize: 13, marginTop: 12 }}>{error}</p>
      )}
    </Modal>
  );
}