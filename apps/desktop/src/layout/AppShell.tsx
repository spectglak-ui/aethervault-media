import { useEffect } from "react";
import { applyNearMax } from "../window/nearMax";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { PlayerDock } from "./PlayerDock";
import { useSidebarCollapsed } from "./useSidebarCollapsed";
import "./layout.css";

/**
 * Mise en page générale de l'application : barre latérale + barre
 * supérieure fixes, contenu de page défilant avec transition douce entre
 * les routes, et zone réservée au lecteur en bas. Chaque route déclarée
 * dans `router.tsx` est rendue dans `<Outlet />`, à l'intérieur de cette
 * même coquille.
 */
export function AppShell() {
  const location = useLocation();
  const { collapsed, isForced, toggleCollapsed } = useSidebarCollapsed();
  // 0.3.0 : fenêtre inset d'environ 1 mm des bords (jamais « maximisé »,
  // jamais en contact avec les bords) — supprime l'artefact DWM.
  useEffect(() => {
    void applyNearMax();
  }, []);
  
  return (
    <div
      className={["avm-shell", collapsed ? "avm-shell--collapsed" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Sidebar collapsed={collapsed} canToggle={!isForced} onToggleCollapsed={toggleCollapsed} />
      <div className="avm-shell__main">
        <TopBar />
        <div className="avm-shell__content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
        <PlayerDock />
      </div>
    </div>
  );
}
