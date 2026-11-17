import { vaultTubeApi, type VaultTubeSubscription } from "./api";

type PlaybackMode = VaultTubeSubscription["mode"];

/**
 * Suit une chaîne ou une playlist DANS le mode de la page courante.
 *
 * Le backend devine le mode d'un abonnement d'après son adresse : une playlist
 * YouTube ordinaire reste en mode « vidéo ». La page Musique n'affichant que les
 * abonnements en mode « audio », la playlist ajoutée depuis la page Musique
 * n'apparaissait jamais dans « Abonnements ». On force donc le mode voulu.
 */
export async function addSubscriptionInMode(
  url: string,
  mode: PlaybackMode | undefined
): Promise<VaultTubeSubscription> {
  const subscription = await vaultTubeApi.addSubscription(url);
  if (mode && subscription.mode !== mode) {
    await vaultTubeApi.setSubscriptionMode(subscription.id, mode);
    return { ...subscription, mode };
  }
  return subscription;
}
