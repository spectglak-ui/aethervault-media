import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Voir https://v2.tauri.app/start/frontend/vite/ — configuration standard
// recommandée par Tauri v2 pour un frontend Vite : port fixe, pas de
// rechargement lors des modifications côté Rust, et exposition optionnelle
// sur le réseau local (mobile) via TAURI_DEV_HOST.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      // Pointe directement vers le fichier source (et non le dossier du
      // package) : évite toute ambiguïté de résolution liée au symlink
      // pnpm workspace vers un package "source-only" sans étape de build.
      "@aethervault/ui-kit": fileURLToPath(
        new URL("../../packages/ui-kit/src/index.ts", import.meta.url)
      ),
      "@aethervault/shared-types": fileURLToPath(
        new URL("../../packages/shared-types/src/index.ts", import.meta.url)
      ),
    },
    // Garantit une seule copie de React dans l'arbre de dépendances : sans
    // ça, un composant importé depuis le package workspace ui-kit pourrait
    // charger une instance de React différente de celle de l'application et
    // provoquer une erreur "Invalid hook call" au runtime.
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
