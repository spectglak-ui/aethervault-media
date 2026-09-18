import { Avatar, IconButton } from "@aethervault/ui-kit";
import { Library, Trash2, Wifi, WifiOff } from "lucide-react";
import type { RemotePresence } from "./api";

interface Props {
  presence: RemotePresence;
  onOpenLibrary: () => void;
  onRemove: () => void;
}

export function RemoteFriendCard({ presence, onOpenLibrary, onRemove }: Props) {
  const { peer_name, online, activity } = presence;

  const progress =
    activity && activity.duration_seconds && activity.duration_seconds > 0
      ? Math.round(
          ((activity.position_seconds ?? 0) / activity.duration_seconds) * 100
        )
      : 0;

  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--color-border, #2c2c33)",
        borderRadius: 12,
        background: "var(--color-surface, #1b1b21)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <Avatar name={peer_name} size={40} />
          <span
            style={{
              position: "absolute",
              bottom: -2,
              right: -2,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: online ? "#4ade80" : "#6b7280",
              border: "2px solid var(--color-surface, #1b1b21)",
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{peer_name}</div>
          <div
            style={{
              fontSize: 11,
              color: online ? "#4ade80" : "var(--color-text-muted, #9a9aa3)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {online ? <Wifi size={10} /> : <WifiOff size={10} />}
            {online ? "En ligne" : "Hors ligne"}
          </div>
        </div>
        <IconButton label="Ouvrir la bibliothèque" onClick={onOpenLibrary}>
          <Library size={14} />
        </IconButton>
        <IconButton label="Retirer des amis" onClick={onRemove}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      {/* Activité en direct */}
      <div style={{ marginTop: 10 }}>
        {activity && activity.title_name ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--color-accent, #7c5cff)",
                fontWeight: 600,
              }}
            >
              <span style={{ fontSize: 8 }}>●</span>
              Regarde actuellement
            </div>
            <div
              style={{
                marginTop: 2,
                fontSize: 12,
                color: "var(--color-text, #f2f2f5)",
              }}
            >
              {activity.title_name}
              {activity.category_key && (
                <span style={{ color: "var(--color-text-muted, #9a9aa3)" }}>
                  {" "}
                  · {activity.category_key}
                </span>
              )}
            </div>
            <div
              style={{
                marginTop: 6,
                height: 3,
                background: "rgba(255,255,255,.08)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "var(--color-accent, #7c5cff)",
                  transition: "width .3s ease",
                }}
              />
            </div>
          </>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-muted, #9a9aa3)",
              fontStyle: "italic",
            }}
          >
            {online ? "Ne regarde rien en ce moment" : "Activité indisponible"}
          </div>
        )}
      </div>
    </div>
  );
}