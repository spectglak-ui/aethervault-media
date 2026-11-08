/**
 * Réglage « bandes annonces dans le Héro de l'accueil » (0.7.8).
 * Désactivé par défaut : la lecture passe par YouTube (connexion Internet,
 * contact d'un service tiers) — un choix explicite, pas une surprise.
 */
const STORAGE_KEY = "avm-home-hero-trailer";
const CHANGED_EVENT = "avm-home-hero-trailer-changed";

export function getHeroTrailerEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHeroTrailerEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // best-effort
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function subscribeHeroTrailerEnabled(listener: (enabled: boolean) => void): () => void {
  const handler = () => listener(getHeroTrailerEnabled());
  window.addEventListener(CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
