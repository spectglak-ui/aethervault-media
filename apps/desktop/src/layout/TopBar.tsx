import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Avatar, SearchInput } from "@aethervault/ui-kit";
import { useActiveProfile } from "../profile/ActiveProfileContext";
import { WindowControls } from "../components/WindowControls";

/**
 * Barre supérieure de la fenêtre principale. Depuis le passage frameless
 * (Étape 7, `"decorations": false` dans tauri.conf.json), elle sert aussi
 * de barre de titre : `data-tauri-drag-region` rend l'espace vide
 * draggable (les enfants — recherche, profil, boutons de fenêtre —
 * restent cliquables), et `<WindowControls />` remplace les boutons
 * natifs réduire/agrandir/fermer.
 */
export function TopBar() {
    const [query, setQuery] = useState(" ");
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProfile } = useActiveProfile();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!activeProfile) return;
    let cancelled = false;
    const load = () => {
      invoke<string | null>("get_profile_avatar", { profileId: activeProfile.id })
        .then((path) => {
          if (!cancelled) setAvatarUrl(path ? convertFileSrc(path) : null);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("avm-avatar-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("avm-avatar-changed", load);
    };
  }, [activeProfile, location.pathname]);
  return (
    <header className="avm-topbar" data-tauri-drag-region>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Rechercher un film, une série, un acteur…"
        onSubmit={() => {
          const trimmed = query.trim();
          if (trimmed.length > 0) {
            navigate(`/explore?q=${encodeURIComponent(trimmed)}`);
          }
        }}
      />
      <div className="avm-topbar__right">
        {activeProfile && (
          <button
            type="button"
            className="avm-topbar__profile"
            onClick={() => navigate("/profiles")}
            title="Changer de profil"
          >
                        {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : (
              <Avatar name={activeProfile.name} size={28} />
            )}
            <span>{activeProfile.name}</span>
          </button>
        )}
        <WindowControls />
      </div>
    </header>
  );
}