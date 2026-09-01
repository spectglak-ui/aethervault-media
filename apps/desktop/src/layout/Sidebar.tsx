import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Compass, Layers, Users, Settings, Share2, BarChart3, PanelLeftClose, PanelLeft } from "lucide-react";
import { NavItem, IconButton } from "@aethervault/ui-kit";
import type { Category } from "@aethervault/shared-types";
import { categoryApi } from "../features/category/api";
import { categoryRoute } from "../lib/categoryRoute";
import { categoryIcon } from "../lib/categoryIcon";
import { Youtube } from "lucide-react";

const SECONDARY_NAV_ITEMS = [
  { path: "/explore", label: "Explorer", icon: Compass },
  { path: "/collections", label: "Collections", icon: Layers },
  { path: "/share", label: "Partage", icon: Share2 },
  { path: "/stats", label: "Time Capsule", icon: BarChart3 },
  { path: "/profiles", label: "Profils", icon: Users },
  { path: "/settings", label: "Paramètres", icon: Settings },
] as const;

interface SidebarProps {
  collapsed: boolean;
  /** Faux quand la réduction est forcée par l'étroitesse de la fenêtre :
   * inutile de proposer un bouton qui ne pourrait rien déplier. */
  canToggle: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Depuis l'Étape 4, les catégories (doc §6.1) remplacent l'ancien lien
 * générique "Bibliothèque" — cohérent avec l'Accueil (`HomePage`), qui
 * suit la même logique de tuiles. Chargées dynamiquement plutôt que codées
 * en dur : la structure reste ouverte à de futures catégories
 * additionnelles (doc §6.1) sans modifier ce fichier.
 */
export function Sidebar({ collapsed, canToggle, onToggleCollapsed }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);

  const refresh = useCallback(() => {
    categoryApi
      .list()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // "/" doit rester une correspondance exacte (tout chemin commence par
  // "/"), les autres sont préfixées : `/category/movies/title/12` doit
  // garder "Films" actif dans la barre latérale.
  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <nav className="avm-sidebar" aria-label="Navigation principale">
      <div className="avm-sidebar__header">
        {!collapsed && <span className="avm-sidebar__brand">AetherVault</span>}
        {canToggle && (
          <IconButton
            label={collapsed ? "Déplier la barre latérale" : "Réduire la barre latérale"}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </IconButton>
        )}
      </div>
      <ul className="avm-sidebar__list">
        <li>
          <NavItem
            icon={<Home size={18} />}
            label="Accueil"
            collapsed={collapsed}
            active={isActive("/")}
            onClick={() => navigate("/")}
          />
        </li>

        {categories.map((category) => (
          <li key={category.id}>
            <NavItem
              icon={categoryIcon(category.key)}
              label={category.name}
              collapsed={collapsed}
              active={isActive(categoryRoute(category))}
              onClick={() => navigate(categoryRoute(category))}
            />
          </li>
        ))}
        <li>
          <NavItem
            icon={<Youtube size={18} />}
            label="VaultTube"
            collapsed={collapsed}
            active={isActive("/vaulttube")}
            onClick={() => navigate("/vaulttube")}
          />
        </li>
        {SECONDARY_NAV_ITEMS.map(({ path, label, icon: Icon }) => (
          <li key={path}>
            <NavItem
              icon={<Icon size={18} />}
              label={label}
              collapsed={collapsed}
              active={isActive(path)}
              onClick={() => navigate(path)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
