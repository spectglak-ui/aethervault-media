interface AvatarProps {
  name: string;
  size?: number;
}

/**
 * Avatar par défaut basé sur les initiales du nom. Un vrai avatar (image
 * personnalisée par profil) pourra remplacer ce rendu à l'Étape 6 sans
 * changer la signature du composant.
 */
export function Avatar({ name, size = 32 }: AvatarProps) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="avm-avatar"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
