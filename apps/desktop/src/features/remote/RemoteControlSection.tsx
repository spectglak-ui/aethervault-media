import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "react-qr-code";
import { Button } from "@aethervault/ui-kit";

interface RemoteInfo {
  url: string;
  token: string;
  port: number;
}

/**
0.8.x — Paramètres → Télécommande mobile : active le serveur local
(HTTP + WebSocket) embarqué dans le Rust et affiche le QR d'appairage.
Le téléphone, sur le même Wi-Fi, scanne le QR (ou ouvre le lien) et
pilote lecture / navigation / recherche. Page installable en PWA.
*/
export function RemoteControlSection() {
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    invoke<RemoteInfo | null>("remote_status")
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        const started = await invoke<RemoteInfo>("remote_start");
        setInfo(started);
        localStorage.setItem("avm-remote-enabled", "1");
      } else {
        await invoke("remote_stop");
        setInfo(null);
        localStorage.setItem("avm-remote-enabled", "0");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copie impossible.");
    }
  };

  return (
    <section className="avm-settings-section">
      <h2>Télécommande mobile</h2>
      <p className="avm-settings-muted">
        Transforme votre téléphone en télécommande : même réseau Wi-Fi que ce PC, scannez le
        QR code (ou ouvrez le lien), puis pilotez la lecture, la navigation et la recherche.
        La page est installable sur l'écran d'accueil du téléphone (PWA).
      </p>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={info !== null}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Activer la télécommande mobile
      </label>
      {info && (
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <div style={{ background: "#fff", padding: 10, borderRadius: 12 }}>
            <QRCode value={info.url} size={148} />
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <p className="avm-settings-muted" style={{ wordBreak: "break-all" }}>{info.url}</p>
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? "Lien copié ✓" : "Copier le lien"}
            </Button>
            <p className="avm-settings-muted">
              Port {info.port} · token d'appairage intégré au lien. Windows peut demander une
              autorisation pare-feu (réseau privé) : acceptez-la une seule fois.
            </p>
          </div>
        </div>
      )}
      {error && <p className="avm-settings-error">{error}</p>}
    </section>
  );
}