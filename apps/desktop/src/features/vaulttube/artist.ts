/**
 * AetherFy Musique : le nom d'artiste d'une piste est le nom de la chaîne YouTube qui la publie.
 * Les chaînes générées par YouTube Music s'appellent « Artiste - Topic » : on garde « Artiste ».
 * `null` si la chaîne est inconnue (piste pas encore resynchronisée).
 */
export function artistFromChannel(channel?: string | null): string | null {
  const name = (channel ?? "").replace(/\s+-\s+Topic$/i, "").trim();
  return name.length > 0 ? name : null;
}
