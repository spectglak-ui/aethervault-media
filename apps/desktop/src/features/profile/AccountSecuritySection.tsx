import { useActiveProfile } from "../../profile/ActiveProfileContext";
import { ProfileSecurityPanel } from "./ProfileSecurityPanel";

/** Paramètres → Mon compte : mot de passe ou code PIN du profil connecté. */
export function AccountSecuritySection() {
  const { activeProfile } = useActiveProfile();
  if (!activeProfile) return null;
  return (
    <section className="avm-settings-section">
      <h2>Mon compte — protection</h2>
      <p className="avm-settings-muted">
        Protégez l'accès à votre compte par un mot de passe ou un code PIN (4 à 8 chiffres). Un code
        de récupération vous est remis pour retrouver l'accès en cas d'oubli. Le Coffre privé a son
        propre secret, distinct de celui-ci.
      </p>
      <ProfileSecurityPanel profile={activeProfile} isSelf />
    </section>
  );
}
