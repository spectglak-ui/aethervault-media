/**
 * Déplacement manuel de la barre de progression, sans saccade.
 *
 * Deux défauts rendaient le glissement saccadé :
 *  1. le moteur renvoie en continu la position RÉELLE de lecture ; pendant le glissement elle
 *     ramenait le curseur en arrière (et il re-sautait quand le seek, retardé, aboutissait) ;
 *  2. le seek n'était envoyé qu'après 150 ms d'immobilité : l'image ne suivait pas le curseur.
 *
 * Ici : (1) tant qu'un seek n'a pas « atterri » (position réelle proche de la cible, ou délai
 * maximal dépassé), les positions du moteur sont ignorées ; (2) les seeks partent au fil du
 * glissement, au plus un toutes les `throttleMs` (le premier tout de suite, le dernier jamais
 * perdu).
 */
export const SEEK_LANDED_TOLERANCE_SECONDS = 1.5;
export const SEEK_HOLD_MAX_MS = 4000;

export class SeekScrubber {
  private target: { value: number; until: number } | null = null;
  private pending: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSentAt = -Infinity;

  constructor(
    private readonly send: (seconds: number) => void,
    private readonly now: () => number = Date.now,
    private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
    private readonly clearTimer: (t: ReturnType<typeof setTimeout>) => void = clearTimeout
  ) {}

  /** L'utilisateur déplace la barre (ou un raccourci saute) vers `seconds`. */
  seek(seconds: number, throttleMs: number): void {
    const t = this.now();
    this.target = { value: seconds, until: t + SEEK_HOLD_MAX_MS };
    this.pending = seconds;
    if (this.timer !== null) return; // un envoi différé est déjà prévu : il portera cette valeur
    const wait = throttleMs - (t - this.lastSentAt);
    if (wait <= 0) this.flush();
    else this.timer = this.setTimer(() => this.flush(), wait);
  }

  private flush(): void {
    this.timer = null;
    if (this.pending === null) return;
    const value = this.pending;
    this.pending = null;
    this.lastSentAt = this.now();
    this.send(value);
  }

  /**
   * Position réelle reçue du moteur : `true` = l'afficher, `false` = l'ignorer (un seek
   * est en cours, le curseur reste sur la cible choisie par l'utilisateur).
   */
  acceptPosition(position: number): boolean {
    const target = this.target;
    if (!target) return true;
    if (this.now() > target.until) {
      this.target = null;
      return true;
    }
    if (Math.abs(position - target.value) <= SEEK_LANDED_TOLERANCE_SECONDS) {
      this.target = null;
      return true;
    }
    return false;
  }

  /** Changement de média / arrêt : on oublie tout seek en cours. */
  reset(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
    this.target = null;
  }
}
