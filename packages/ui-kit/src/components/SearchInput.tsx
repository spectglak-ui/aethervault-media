import { Search } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
}

export function SearchInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Rechercher…",
}: SearchInputProps) {
  return (
    <form
      className="avm-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <Search size={16} className="avm-search__icon" aria-hidden="true" />
      <input
        className="avm-search__input"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Rechercher dans AetherVault Media"
      />
    </form>
  );
}
