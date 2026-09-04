import { X } from "lucide-react";
import { usePlayer } from "./PlayerContext";

/**
 * Bannière d'erreur du lecteur (0.4.1 audit UX) : affiche les erreurs
 * de lecture avec bouton de fermeture. Visible en overlay au-dessus du
 * canvas vidéo pour que l'utilisateur comprenne pourquoi rien ne se passe.
 */
export function PlayerErrorBanner() {
  const { lastError, dismissError } = usePlayer();
  
  if (!lastError) return null;
  
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        right: 16,
        zIndex: 1000,
        padding: "12px 16px",
        background: "rgba(255, 59, 48, 0.15)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255, 59, 48, 0.4)",
        borderRadius: 8,
        color: "#ff6b6b",
        fontSize: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        animation: "slideDown 0.3s ease-out",
      }}
    >
      <span style={{ flex: 1 }}>{lastError}</span>
      <button
        onClick={dismissError}
        aria-label="Fermer l'erreur"
        style={{
          background: "transparent",
          border: "1px solid rgba(255, 59, 48, 0.4)",
          color: "#ff6b6b",
          cursor: "pointer",
          padding: "4px 8px",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
        }}
      >
        <X size={14} />
        Fermer
      </button>
    </div>
  );
}