import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, SearchInput } from "@aethervault/ui-kit";
import { useActiveProfile } from "../profile/ActiveProfileContext";

export function TopBar() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { activeProfile } = useActiveProfile();

  return (
    <header className="avm-topbar">
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

      {activeProfile && (
        <button
          type="button"
          className="avm-topbar__profile"
          onClick={() => navigate("/profiles")}
          title="Changer de profil"
        >
          <Avatar name={activeProfile.name} size={28} />
          <span>{activeProfile.name}</span>
        </button>
      )}
    </header>
  );
}
