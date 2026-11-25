import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "react-qr-code";
import { Button } from "@aethervault/ui-kit";

interface RemoteInfo {
  url: string;
  token: string;
  port: number;
}

/** Diagnostic réseau de la télécommande. */
interface NetworkCheck {
  platform: string;
  category: string | null;
  network_name: string | null;
  needs_fix: boolean;
}

/**
 * Paramètres → Télécommande mobile.
 *
 * Active le serveur local HTTP + WebSocket embarqué dans Rust
 * et affiche le QR code d'appairage.
 *
 * Le téléphone, connecté au même réseau, peut piloter
 * la lecture, la navigation et la recherche.
 */
export function RemoteControlSection() {
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [net, setNet] = useState<NetworkCheck | null>(null);
  const [networkCheckFailed, setNetworkCheckFailed] = useState(false);

  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState(false);

  useEffect(() => {
    invoke<RemoteInfo | null>("remote_status")
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const active = info !== null;

  // Diagnostic réseau dès que le serveur de télécommande est actif.
  useEffect(() => {
    if (!active) {
      setNet(null);
      setNetworkCheckFailed(false);
      setFixed(false);
      return;
    }

    let cancelled = false;

    setNet(null);
    setNetworkCheckFailed(false);
    setFixed(false);

    invoke<NetworkCheck>("remote_network_check")
      .then((result) => {
        if (!cancelled) {
          setNet(result);
          setNetworkCheckFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNet(null);
          setNetworkCheckFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  // Un profil privé est considéré confirmé uniquement si
  // Windows a effectivement retourné cette catégorie.
  const networkIsPrivate =
    net?.platform === "windows" &&
    net.category === "Private" &&
    !net.needs_fix;

  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(null);
    setFixed(false);

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

  // Correction du profil réseau et création de la règle pare-feu.
  const fixNetwork = async () => {
    setFixing(true);
    setFixed(false);
    setError(null);

    try {
      const result = await invoke<NetworkCheck>("remote_fix_network");

      setNet(result);
      setNetworkCheckFailed(false);

      // Ne jamais annoncer une réussite sans confirmation du profil privé.
      if (
        result.platform !== "windows" ||
        result.category !== "Private" ||
        result.needs_fix
      ) {
        setFixed(false);
        setError(
          "Windows n'a pas confirmé le passage du réseau en profil privé. " +
          "La correction n'est pas considérée comme réussie."
        );
        return;
      }

      setFixed(true);
    } catch (err) {
      setFixed(false);
      setNetworkCheckFailed(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFixing(false);
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
        Transforme votre téléphone en télécommande : même réseau Wi-Fi que ce PC,
        scannez le QR code (ou ouvrez le lien), puis pilotez la lecture,
        la navigation et la recherche. La page est installable sur l'écran
        d'accueil du téléphone (PWA).
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
        <div
          style={{
            display: "flex",
            gap: 18,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 14,
          }}
        >
          <div style={{ background: "#fff", padding: 10, borderRadius: 12 }}>
            <QRCode value={info.url} size={148} />
          </div>

          <div style={{ minWidth: 220, flex: 1 }}>
            <p
              className="avm-settings-muted"
              style={{ wordBreak: "break-all" }}
            >
              {info.url}
            </p>

            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? "Lien copié ✓" : "Copier le lien"}
            </Button>

            <p className="avm-settings-muted">
              Port {info.port} · token d'appairage intégré au lien.
              Si Windows demande une autorisation pare-feu,
              acceptez-la sur votre réseau privé.
            </p>
          </div>
        </div>
      )}

      {/* Diagnostic impossible : erreur d'exécution PowerShell ou Tauri. */}
      {info && networkCheckFailed && (
        <p role="alert" className="avm-settings-error">
          Le diagnostic réseau Windows n'a pas pu être exécuté.
          Impossible de confirmer la configuration du pare-feu.
        </p>
      )}

      {/* Diagnostic disponible, mais catégorie réseau inconnue. */}
      {info &&
        net?.platform === "windows" &&
        net.category === null && (
          <p role="status" className="avm-settings-error">
            Profil réseau inconnu. Windows n'a pas permis d'identifier
            le réseau utilisé par la télécommande.
          </p>
        )}

      {/* Réseau public : proposer une correction. */}
      {info && net?.platform === "windows" && net.needs_fix && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--color-warning, #f59f00)",
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            <strong>
              Le téléphone risque de ne pas pouvoir charger la page.
            </strong>{" "}
            Votre réseau
            {net.network_name ? ` « ${net.network_name} »` : ""}
            est classé « Public ». Le pare-feu Windows peut alors
            bloquer les connexions entrantes.
            S'il s'agit de votre réseau personnel de confiance,
            vous pouvez le passer en « Privé ».
          </p>

          <Button
            variant="primary"
            disabled={fixing}
            onClick={() => void fixNetwork()}
          >
            {fixing
              ? "En attente de l'autorisation Windows…"
              : "Passer ce réseau en privé"}
          </Button>

          <p className="avm-settings-muted">
            Windows demandera une autorisation administrateur.
            À ne faire que sur un réseau de confiance (domicile),
            jamais sur un Wi-Fi public.
          </p>
        </div>
      )}

      {/* Profil privé confirmé avant toute correction. */}
      {info &&
        networkIsPrivate &&
        !fixed && (
          <p role="status" className="avm-settings-success">
            Windows confirme que ce réseau est classé « Privé ».
          </p>
        )}

      {/* Profil privé confirmé après la correction UAC. */}
      {info &&
        fixed &&
        networkIsPrivate && (
          <p role="status" className="avm-settings-success">
            Profil réseau privé confirmé et règle pare-feu configurée.
            Rescannez le QR code sur votre téléphone.
          </p>
        )}

      {/* Réseau géré par un domaine Windows. */}
      {info &&
        net?.platform === "windows" &&
        net.category === "DomainAuthenticated" && (
          <p role="status" className="avm-settings-muted">
            Ce réseau utilise le profil Domaine.
            Sa configuration de sécurité peut être gérée par
            l'administrateur réseau. Aucune modification automatique
            ne sera effectuée.
          </p>
        )}

      {/* Autres plateformes : pas de diagnostic Windows. */}
      {info && net?.platform === "other" && (
        <p role="status" className="avm-settings-muted">
          Le diagnostic automatique du pare-feu Windows n'est pas
          disponible sur cette plateforme.
        </p>
      )}

      {error && (
        <p className="avm-settings-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}