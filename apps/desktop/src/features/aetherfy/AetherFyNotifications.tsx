import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import type { VaultTubeVideo } from "../vaulttube/api";
import { vaultTubeApi } from "../vaulttube/api";

const SEEN_KEY = "afy_notif_seen_ts";
const UNSEEN_KEY = "afy_notif_unseen";

/**
 * 0.8.2 — cloche AetherFy : dépliant par-dessus l'interface listant les
 * 5 vidéos les plus récentes des chaînes suivies. « Temps réel » :
 * rechargement à l'ouverture + poll 60 s tant que le panneau est ouvert
 * (alimenté par les syncs auto 6 h / manuelles).
 */
export function AetherFyNotifications({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<VaultTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const load = async () => {
    try {
      const subs = await vaultTubeApi.listSubscriptions();
      const chunks = await Promise.all(
        subs.slice(0, 15).map(async (s) => {
          try {
            return await vaultTubeApi.listVideos(s.id);
          } catch {
            return [] as VaultTubeVideo[];
          }
        })
      );
      const flat = chunks.flat().sort((a, b) => (b.added_at ?? 0) - (a.added_at ?? 0));
      setItems(flat.slice(0, 5)); // max 5 vidéos dans la fenêtre
      const seen = Number(localStorage.getItem(SEEN_KEY) ?? 0);
      const n = flat.filter((v) => (v.added_at ?? 0) > seen).length;
      setUnseen(n);
      try {
        localStorage.setItem(UNSEEN_KEY, String(n));
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(t);
  }, []);

  const open = (v: VaultTubeVideo) => {
    try {
      localStorage.setItem(SEEN_KEY, String(Math.floor(Date.now() / 1000)));
      localStorage.setItem(UNSEEN_KEY, "0");
    } catch {}
    onClose();
    navigate(`/aetherfy/watch/${v.youtube_id}`, { state: { video: v } });
  };

  return (
    <div className="afy-panel">
      <div className="afy-panel__head">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Bell size={16} style={{ color: "#ff9f1c" }} /> Notifications
          {unseen > 0 && <span className="afy-panel__badge">{unseen} nouvelle(s)</span>}
        </span>
        <button type="button" className="afy-playlist__icon-btn" onClick={onClose} title="Fermer">
          <X size={16} />
        </button>
      </div>
      {loading && items.length === 0 ? (
        <div className="afy-comments__loading">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="afy-comments__empty">Aucune vidéo récente : lancez une synchronisation.</div>
      ) : (
        items.map((v) => (
          <button key={`${v.source}-${v.youtube_id}`} type="button" className="afy-notif-item" onClick={() => open(v)}>
            {v.thumbnail_url && <img className="afy-notif-item__thumb" src={v.thumbnail_url} alt="" />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="afy-notif-item__title">{v.title}</div>
              <div className="afy-notif-item__meta">
                {v.channel ?? "Chaîne"} • ajouté {new Date((v.added_at ?? 0) * 1000).toLocaleDateString("fr-FR")}
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}