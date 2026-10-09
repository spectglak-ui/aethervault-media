import { useActiveProfile } from "../../profile/ActiveProfileContext";

/** Bandeau d'accueil : salutation selon l'heure + date du jour. */
export function HomeWelcome() {
  const { activeProfile } = useActiveProfile();
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour >= 5 && hour < 12 ? "Bonjour" : hour >= 12 && hour < 18 ? "Bon après-midi" : "Bonsoir";
  const date = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="avm-hx-welcome">
      <span className="avm-hx-kicker">{date}</span>
      <div className="avm-hx-welcome__title">
        {greeting}
        {activeProfile ? (
          <>
            , <span className="avm-hx-welcome__name">{activeProfile.name}</span>
          </>
        ) : null}
      </div>
      <span className="avm-hx-welcome__sub">Votre univers, prêt à être exploré.</span>
    </div>
  );
}
