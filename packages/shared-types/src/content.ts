/**
 * Miroirs des structures Rust exposées par `commands::category` et
 * `commands::title` (Étape 4, doc §6.1/§6.3).
 */

export interface Category {
  id: number;
  key: string;
  name: string;
  icon: string | null;
  /** Bannière *effective* (16:9) : personnalisée si l'utilisateur en a
   * choisi une, sinon celle du Metadata Service (absente en pratique tant
   * qu'aucun fournisseur en ligne n'existe — voir doc §8, Étape 4). */
  banner: string | null;
  /** `true` si `banner` provient d'une personnalisation utilisateur —
   * commande l'affichage du bouton "Réinitialiser" (doc §6.6, Étape 5). */
  banner_is_custom: boolean;
  sort_order: number;
  is_system: boolean;
  /** `null` uniquement pour la catégorie Privé — jamais de compteur avant
   * authentification (doc §6.4), y compris sur la tuile d'Accueil. */
  title_count: number | null;
}

export type TitleKind = "movie" | "series";

export interface TitleSummary {
  id: number;
  category_id: number;
  kind: TitleKind;
  name: string;
  year: number | null;
  /** Affiche effective (personnalisée si elle existe, sinon Metadata
   * Service) — `null` tant qu'aucune des deux n'est disponible : le
   * composant `Card` affiche déjà un espace réservé dans ce cas. */
  poster: string | null;
}

export interface TitleCredit {
  name: string;
  character_name: string | null;
}

export interface SeasonSummary {
  id: number;
  season_number: number;
  name: string | null;
  episode_count: number;
}

export interface EpisodeSummary {
  id: number;
  episode_number: number;
  name: string | null;
  description: string | null;
  duration_seconds: number | null;
  still: string | null;
  /** Fichier à lire pour cet épisode — `null` si le Metadata Service a
   * créé l'épisode sans qu'un fichier n'y soit encore rattaché (ne
   * devrait pas arriver dans le flux actuel, mais reste possible en
   * théorie). */
  media_file_id: number | null;
}

export interface TitleDetails {
  id: number;
  category_id: number;
  kind: TitleKind;
  name: string;
  description: string | null;
  year: number | null;
  /** Pertinent uniquement pour `kind = "movie"` (doc §6.3). */
  duration_seconds: number | null;
  poster: string | null;
  /** `true` si `poster` provient d'une personnalisation utilisateur (doc
   * §6.6, Étape 5) — commande l'affichage du bouton "Réinitialiser". */
  poster_is_custom: boolean;
  banner: string | null;
  banner_is_custom: boolean;
  rating: number | null;
  genres: string[];
  studios: string[];
  cast: TitleCredit[];
  directors: string[];
  /** Vide pour `kind = "movie"`. */
  seasons: SeasonSummary[];
  /** Fichier à lire pour `kind = "movie"` uniquement — `null` pour
   * `kind = "series"` (la lecture se fait au niveau d'un épisode, voir
   * `EpisodeSummary.media_file_id`). */
  media_file_id: number | null;
}
