import { useEffect, useRef, useState } from "react";
import { UserRound, Link2, Pencil, Trash2, X } from "lucide-react";
import { vaultTubeApi } from "../vaulttube/api";

export interface AfyAccount {
  pseudo: string;
  avatar: string | null; // data URL ou null
  linkedChannel: string | null;
}

const KEY = "afy_account_v1";

export function getAfyAccount(): AfyAccount | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AfyAccount) : null;
  } catch {
    return null;
  }
}
function saveAccount(a: AfyAccount | null) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {}
}

/**
 * 0.8.2 — menu compte AetherFy :
 *  - profil LOCAL (pseudo + avatar personnalisé, stocké en localStorage) ;
 *  - « liaison YouTube » : SANS clé API OAuth (choix historique de
 *    l'app : tout via yt-dlp), les abonnements PRIVÉS d'un compte
 *    YouTube sont inaccessibles. La liaison importe donc ce qui est
 *    public : la chaîne fournie devient un abonnement AetherFy et ses
 *    playlists publiques sont synchronisées. C'est le maximum
 *    possible sans OAuth — et c'est déjà très utile.
 */
export function AetherFyAccountMenu({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const existing = getAfyAccount();
  const [mode, setMode] = useState<"choose" | "create" | "link">(existing ? "create" : "choose");
  const [pseudo, setPseudo] = useState(existing?.pseudo ?? "");
  const [avatar, setAvatar] = useState<string | null>(existing?.avatar ?? null);
  const [channelUrl, setChannelUrl] = useState(existing?.linkedChannel ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  };

  const submitCreate = () => {
    if (!pseudo.trim()) {
      setError("Choisis un pseudo.");
      return;
    }
    saveAccount({
      pseudo: pseudo.trim(),
      avatar,
      linkedChannel: existing?.linkedChannel ?? null,
    });
    onChanged();
    onClose();
  };

  const submitLink = async () => {
    if (!channelUrl.trim()) {
      setError("Colle l'URL de ta chaîne YouTube.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sub = await vaultTubeApi.addSubscription(channelUrl.trim());
      await vaultTubeApi.syncPlaylists(sub.id).catch(() => {});
      saveAccount({
        pseudo: existing?.pseudo ?? sub.name,
        avatar: existing?.avatar ?? sub.thumbnail_url ?? null,
        linkedChannel: sub.url,
      });
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Liaison impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="afy-panel">
      <div className="afy-panel__head">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UserRound size={16} style={{ color: "#2ec4b6" }} /> Compte AetherFy
        </span>
        <button type="button" className="afy-playlist__icon-btn" onClick={onClose} title="Fermer">
          <X size={16} />
        </button>
      </div>

      {mode === "choose" && (
        <>
          <button type="button" className="afy-menu__item" onClick={() => setMode("create")}>
            <Pencil size={14} /> Créer un compte AetherFy (pseudo + avatar)
          </button>
          <button type="button" className="afy-menu__item" onClick={() => setMode("link")}>
            <Link2 size={14} /> Lier un compte YouTube
          </button>
        </>
      )}

      {mode === "create" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="afy-avatar-preview">
              {avatar ? <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (pseudo || "?").slice(0, 2).toUpperCase()}
            </div>
            <button type="button" className="afy-btn-secondary" onClick={() => fileRef.current?.click()}>
              Choisir un avatar
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </div>
          <label className="afy-field">
            Pseudo
            <input type="text" value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder="Ton pseudo de rêve…" />
          </label>
          {error && <div style={{ color: "#fb7185", fontSize: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="afy-btn-primary" onClick={submitCreate}>
              Enregistrer
            </button>
            {existing && (
              <button
                type="button"
                className="afy-btn-secondary"
                onClick={() => {
                  saveAccount(null);
                  onChanged();
                  onClose();
                }}
              >
                <Trash2 size={14} /> Supprimer
              </button>
            )}
          </div>
          {!existing && (
            <button type="button" className="afy-menu__item" onClick={() => setMode("link")}>
              <Link2 size={14} /> …ou lier un compte YouTube
            </button>
          )}
        </>
      )}

      {mode === "link" && (
        <>
          <div style={{ fontSize: 12, color: "var(--afy-text-muted)", lineHeight: 1.5 }}>
            Sans clé API OAuth, AetherFy ne peut pas lire tes abonnements
            privés YouTube. La liaison importe donc le public : la chaîne
            indiquée devient un abonnement et ses playlists publiques sont
            synchronisées.
          </div>
          <label className="afy-field">
            URL de la chaîne YouTube
            <input type="url" value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} placeholder="https://www.youtube.com/@…" />
          </label>
          {error && <div style={{ color: "#fb7185", fontSize: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="afy-btn-primary" onClick={() => void submitLink()} disabled={busy}>
              {busy ? "Liaison…" : "Lier la chaîne"}
            </button>
            <button type="button" className="afy-btn-secondary" onClick={() => setMode(existing ? "create" : "choose")}>
              Retour
            </button>
          </div>
        </>
      )}
    </div>
  );
}