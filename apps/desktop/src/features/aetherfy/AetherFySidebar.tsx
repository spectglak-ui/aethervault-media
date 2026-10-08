import { useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Flame,
  Users,
  Library,
  History,
  Clock,
  Heart,
  Music,
  Gamepad2,
  Radio,
  Sparkles,
} from "lucide-react";

interface NavEntry {
  path: string;
  label: string;
  icon: typeof Home;
}

const PRIMARY_NAV: NavEntry[] = [
  { path: "/aetherfy", label: "Accueil", icon: Home },
  { path: "/aetherfy/trending", label: "Tendances", icon: Flame },
  { path: "/aetherfy/subscriptions", label: "Abonnements", icon: Users },
  { path: "/aetherfy/library", label: "Bibliothèque", icon: Library },
];

const SECONDARY_NAV: NavEntry[] = [
  { path: "/aetherfy/history", label: "Historique", icon: History },
  { path: "/aetherfy/watch-later", label: "À regarder plus tard", icon: Clock },
  { path: "/aetherfy/liked", label: "Vidéos aimées", icon: Heart },
];

const EXPLORE_NAV: NavEntry[] = [
  { path: "/aetherfy/music", label: "Musique", icon: Music },
  { path: "/aetherfy/gaming", label: "Jeux oniriques", icon: Gamepad2 },
  { path: "/aetherfy/live", label: "Directs", icon: Radio },
];

export function AetherFySidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = (path: string) =>
    path === "/aetherfy" ? location.pathname === "/aetherfy" : location.pathname.startsWith(path);

  const renderSection = (label: string, items: NavEntry[]) => (
    <>
      <div className="afy-sidebar__section-label">{label}</div>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.path}
            type="button"
            className={`afy-nav-item${isActive(item.path) ? " afy-nav-item--active" : ""}`}
            onClick={() => navigate(item.path)}
          >
            <Icon size={18} className="afy-nav-item__icon" />
            <span className="afy-nav-item__label">{item.label}</span>
          </button>
        );
      })}
    </>
  );

  return (
    <aside className="afy-sidebar">
      <div className="afy-sidebar__brand">
        <div className="afy-sidebar__logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M8 5v14l11-7z" fill="#fff" />
          </svg>
        </div>
         <div>
          <div className="afy-sidebar__title">
            <span className="avm-brand-aetherfy">AetherFy</span>
            <span className="afy-sidebar__badge">Dream</span>
          </div>
        </div>
      </div>

      {renderSection("", PRIMARY_NAV)}
      {renderSection("BIBLIOTHÈQUE", SECONDARY_NAV)}
      {renderSection("EXPLOREZ LE RÊVE", EXPLORE_NAV)}

      <div className="afy-ambient-card">
        <div className="afy-ambient-card__head">
          <Sparkles size={16} color="#ff9f1c" />
          <span className="afy-ambient-card__title">Mode ambiant</span>
        </div>
        <div className="afy-ambient-card__sub">Halo cinématique actif</div>
        <button type="button" className="afy-ambient-toggle">
          <span>Activé</span>
          <span className="afy-ambient-toggle__knob" />
        </button>
      </div>
    </aside>
  );
}