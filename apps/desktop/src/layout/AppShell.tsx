import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { applyNearMax } from "../window/nearMax";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { PlayerDock } from "./PlayerDock";
import { useSidebarCollapsed } from "./useSidebarCollapsed";
import { usePlayer } from "../player/PlayerContext";
import { AudioPlayerOverlay } from "../player/AudioPlayerOverlay";
import { VideoWatchLayout } from "../player/VideoWatchLayout";
import "./layout.css";

export function AppShell() {
  const location = useLocation();
  const { collapsed, isForced, toggleCollapsed } = useSidebarCollapsed();
  const { immersiveMode, immersiveOpen } = usePlayer();

  useEffect(() => {
    void applyNearMax();
  }, []);

  return (
    <div
      className={[
        "avm-shell",
        collapsed ? "avm-shell--collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Sidebar
        collapsed={collapsed}
        canToggle={!isForced}
        onToggleCollapsed={toggleCollapsed}
      />
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
        {immersiveOpen && immersiveMode === "audio" && <AudioPlayerOverlay />}
        {immersiveOpen && immersiveMode === "video" && <VideoWatchLayout />}
      </div>
    </div>
  );
}