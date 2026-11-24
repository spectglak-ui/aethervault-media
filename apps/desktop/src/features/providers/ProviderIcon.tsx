import { useEffect, useState, type CSSProperties } from "react";
import { faviconUrls, providerHost, type ProviderEntry } from "./api";

/**
Icône réelle du site (favicon HD via Google, repli DuckDuckGo), puis
monogramme sur dégradé de la couleur de marque si aucun favicon ne
répond — jamais d'image cassée à l'écran.
*/
export function ProviderIcon({
  entry,
  size = 40,
}: {
  entry: Pick<ProviderEntry, "name" | "url" | "color">;
  size?: number;
}) {
  const host = providerHost(entry.url);
  const chain = faviconUrls(host);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [host]);
  const style = { width: size, height: size, "--pv-color": entry.color } as CSSProperties;
  if (index < chain.length) {
    return (
      <img
        className="avm-pv-icon"
        style={style}
        src={chain[index]}
        alt=""
        loading="lazy"
        onError={() => setIndex((i) => i + 1)}
      />
    );
  }
  return (
    <span className="avm-pv-icon avm-pv-icon--mono" style={style} aria-hidden="true">
      {(entry.name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}