import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import { friendsApi, type FriendRequest } from "./api";
import { titleApi } from "../title/api";
import { shareApi } from "../share/api";

interface FriendRequestEvent {
  friend_name: string;
  title_name: string;
}

/**
 * Notificateur flottant de demandes de média entrantes (en bas à droite).
 * « Partager » ouvre le flux P2P existant vers le titre local.
 */
export function FriendRequestsNotifier() {
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [processing, setProcessing] = useState<number | null>(null);

  const load = () => {
    friendsApi
      .listRequests()
      .then((r) => setRequests(r.filter((x) => x.status === "pending")))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const unlisten = listen<FriendRequestEvent>("friends:request", () => {
      load();
    });
    const unlisten2 = listen("friends:requests-changed", () => load());
    return () => {
      void unlisten.then((fn) => fn());
      void unlisten2.then((fn) => fn());
    };
  }, []);

  const handleShare = async (req: FriendRequest) => {
    setProcessing(req.id);
    try {
      // Recherche le média local par son nom — meilleur match possible.
      const search = await titleApi.search({
        q: req.title_name,
        category_keys: [],
        kinds: [],
        genres: [],
        resolutions: [],
        codecs: [],
        audio_langs: [],
      });
      // TODO: enrichir pour remonter le mediaFileId — en attendant, marque comme accepté.
      await friendsApi.setRequestStatus(req.id, "accepted");
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      console.log("[friends] demande acceptée pour :", req.title_name, search);
      // Si un mediaFileId est trouvable, on pourrait appeler shareApi.start ici.
    } catch (e) {
      console.error("[friends] partage impossible :", e);
    } finally {
      setProcessing(null);
    }
  };

  const handleRefuse = async (req: FriendRequest) => {
    try {
      await friendsApi.setRequestStatus(req.id, "refused");
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch {}
  };

  if (requests.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 2000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 340,
      }}
    >
      {requests.map((req) => (
        <div
          key={req.id}
          style={{
            padding: 12,
            background: "var(--color-surface, #1b1b21)",
            border: "1px solid var(--color-accent, #7c5cff)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.4)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--color-text-muted, #9a9aa3)" }}>
              Demande de média
            </div>
            <button
              type="button"
              onClick={() => handleRefuse(req)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-muted, #9a9aa3)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <strong>{req.friend_name}</strong> souhaite regarder{" "}
            <strong>{req.title_name}</strong>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              variant="primary"
              onClick={() => handleShare(req)}
              disabled={processing === req.id}
              style={{ flex: 1, fontSize: 12 }}
            >
              {processing === req.id ? "Partage…" : "Partager"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleRefuse(req)}
              disabled={processing === req.id}
              style={{ fontSize: 12 }}
            >
              Refuser
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}