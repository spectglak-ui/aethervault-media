import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useTypography() {
  useEffect(() => {
    invoke<{ display: string; ui: string; body: string; mono: string }>(
      "get_typography_settings"
    )
      .then((settings) => {
        document.documentElement.style.setProperty(
          "--font-display",
          `"${settings.display}", system-ui, sans-serif`
        );
        document.documentElement.style.setProperty(
          "--font-ui",
          `"${settings.ui}", system-ui, sans-serif`
        );
        document.documentElement.style.setProperty(
          "--font-body",
          `"${settings.body}", system-ui, sans-serif`
        );
        document.documentElement.style.setProperty(
          "--font-mono",
          `"${settings.mono}", ui-monospace, monospace`
        );
      })
      .catch(() => {});
  }, []);
}