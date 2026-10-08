import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Menu, Mic, Search, Bell, Plus } from "lucide-react";
import { AetherFyNotifications } from "./AetherFyNotifications";
import { AetherFyAccountMenu, getAfyAccount } from "./AetherFyAccountMenu";

export function AetherFyTopbar({ showBack = false }: { showBack?: boolean }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTick, setAccountTick] = useState(0);
  const [notifDot, setNotifDot] = useState(false);

  // Pastille « nouvelles vidéos » : lecture légère (localStorage),
  // rafraîchie au montage + toutes les 30 s.
  useEffect(() => {
    const read = () => {
      try {
        setNotifDot(Number(localStorage.getItem("afy_notif_unseen") ?? 0) > 0);
      } catch {}
    };
    read();
    const t = window.setInterval(read, 30000);
    return () => window.clearInterval(t);
  }, [notifOpen]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/aetherfy/search?q=${encodeURIComponent(query.trim())}`);
  };

  // Rendu forcé par accountTick après création/modification de compte.
  void accountTick;
  const account = getAfyAccount();

  return (
    <header className="afy-topbar">
      {showBack ? (
        <button type="button" className="afy-topbar__back" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>
      ) : (
        <button type="button" className="afy-topbar__icon-btn" title="Menu">
          <Menu size={18} />
        </button>
      )}

      <form className="afy-topbar__search" onSubmit={handleSearch}>
        <Search size={16} color="#5f747c" />
        <input
          type="text"
          placeholder="Rechercher dans le rêve…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="afy-topbar__search-btn" title="Rechercher">
          <Search size={16} />
        </button>
        <button type="button" className="afy-topbar__search-btn" title="Recherche vocale">
          <Mic size={16} />
        </button>
      </form>

      <div className="afy-topbar__actions">
        <button type="button" className="afy-topbar__icon-btn" title="Créer">
          <Plus size={18} />
        </button>
        <button
          type="button"
          className="afy-topbar__icon-btn"
          title="Notifications"
          style={{ position: "relative" }}
          onClick={() => {
            setNotifOpen((o) => !o);
            setAccountOpen(false);
          }}
        >
          <Bell size={18} />
          {notifDot && <span className="afy-topbar__dot" />}
        </button>
        <button
          type="button"
          className="afy-topbar__avatar"
          title={account?.pseudo ?? "Compte"}
          onClick={() => {
            setAccountOpen((o) => !o);
            setNotifOpen(false);
          }}
        >
          {account?.avatar ? (
            <img src={account.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
          ) : account?.pseudo ? (
            account.pseudo.slice(0, 2).toUpperCase()
          ) : (
            "AV"
          )}
        </button>
      </div>

      {notifOpen && <AetherFyNotifications onClose={() => setNotifOpen(false)} />}
      {accountOpen && (
        <AetherFyAccountMenu
          onClose={() => setAccountOpen(false)}
          onChanged={() => setAccountTick((t) => t + 1)}
        />
      )}
    </header>
  );
}