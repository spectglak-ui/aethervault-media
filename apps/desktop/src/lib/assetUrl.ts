import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Convertit un chemin de fichier local (tel que renvoyé par le backend
 * pour les affiches/bannières — `Category.banner`, `TitleSummary.poster`,
 * `TitleDetails.poster`/`banner`) en URL affichable dans un `<img>`, via le
 * protocole `asset` de Tauri v2 (activé avec une portée large dans
 * `tauri.conf.json`, §9 de la doc technique). `null` reste `undefined`
 * plutôt que de produire une URL invalide — les composants d'affichage
 * (`Card`) gèrent déjà nativement l'absence d'image.
 */
export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  return convertFileSrc(path);
}
