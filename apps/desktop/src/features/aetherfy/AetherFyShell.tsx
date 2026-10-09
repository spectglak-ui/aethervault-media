import { type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { AetherFySidebar } from "./AetherFySidebar";
import { AetherFyTopbar } from "./AetherFyTopbar";
import "./aetherfy-modern.css";

/**
 * Layout dédié AetherFy : sidebar + topbar + zone de contenu.
 * Utilisé comme wrapper pour toutes les routes `/aetherfy/*`.
 */
export function AetherFyShell({ children }: { children?: ReactNode }) {
  return (
    <div className="afy-shell">
      <AetherFySidebar />
      <main className="afy-main">
        <AetherFyTopbar />
        {children ?? <Outlet />}
      </main>
    </div>
  );
}