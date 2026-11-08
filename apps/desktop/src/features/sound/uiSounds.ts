/**
 * Sons d'interface (0.7.8) — moteur de lecture.
 *
 * Les sons sont des fichiers WAV synthétisés par `scripts/generate-ui-sounds.py`
 * (public/sounds/ui/). Ils sont décodés UNE fois dans des AudioBuffers puis
 * rejoués via Web Audio : latence quasi nulle (indispensable pour un clic),
 * aucun élément <audio> à créer, et un seul réglage de volume maître.
 *
 * Réglages (localStorage `avm-ui-sounds`) : activés, volume, sons au survol,
 * son d'accueil. Les changements sont diffusés par l'événement
 * `avm-ui-sounds-changed` (même fenêtre) et `storage` (autres fenêtres).
 */

export type UiSoundId =
  | "tap"
  | "tap-primary"
  | "select"
  | "toggle-on"
  | "toggle-off"
  | "nav"
  | "open"
  | "close"
  | "success"
  | "error"
  | "notify"
  | "favorite"
  | "delete"
  | "unlock"
  | "lock"
  | "welcome"
  | "play"
  | "hover"
  | "copy";

export const UI_SOUND_IDS: UiSoundId[] = [
  "tap", "tap-primary", "select", "toggle-on", "toggle-off", "nav", "open", "close",
  "success", "error", "notify", "favorite", "delete", "unlock", "lock", "welcome",
  "play", "hover", "copy",
];

export function isUiSoundId(value: string | undefined | null): value is UiSoundId {
  return !!value && (UI_SOUND_IDS as string[]).includes(value);
}

export interface UiSoundSettings {
  /** Interrupteur général. */
  enabled: boolean;
  /** 0 → 1 (courbe perceptuelle appliquée à la lecture). */
  volume: number;
  /** Tic très discret au survol des boutons et cartes. */
  hover: boolean;
  /** Petite signature sonore à la connexion. */
  welcome: boolean;
}

const STORAGE_KEY = "avm-ui-sounds";
const CHANGED_EVENT = "avm-ui-sounds-changed";
const DEFAULTS: UiSoundSettings = { enabled: true, volume: 0.6, hover: false, welcome: true };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function getUiSoundSettings(): UiSoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UiSoundSettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
      volume: typeof parsed.volume === "number" ? clamp01(parsed.volume) : DEFAULTS.volume,
      hover: typeof parsed.hover === "boolean" ? parsed.hover : DEFAULTS.hover,
      welcome: typeof parsed.welcome === "boolean" ? parsed.welcome : DEFAULTS.welcome,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setUiSoundSettings(patch: Partial<UiSoundSettings>): UiSoundSettings {
  const next = { ...getUiSoundSettings(), ...patch, volume: clamp01(patch.volume ?? getUiSoundSettings().volume) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // best-effort : le réglage vaut au moins pour cette session
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
  return next;
}

/** S'abonne aux changements de réglages ; retourne la fonction de désabonnement. */
export function subscribeUiSoundSettings(listener: (settings: UiSoundSettings) => void): () => void {
  const handler = () => listener(getUiSoundSettings());
  window.addEventListener(CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// ------------------------------------------------------------------ moteur
let context: AudioContext | null = null;
let master: GainNode | null = null;
let ducked = false;
const buffers = new Map<UiSoundId, AudioBuffer>();
const loading = new Map<UiSoundId, Promise<AudioBuffer | null>>();
const lastPlayed = new Map<UiSoundId, number>();

/** Intervalle minimal entre deux lectures du même son (évite les rafales). */
const MIN_GAP_MS: Partial<Record<UiSoundId, number>> = {
  tap: 28, select: 28, hover: 80, nav: 90, copy: 120, open: 150, close: 150, error: 500,
};
const DEFAULT_GAP_MS = 40;

/** Courbe perceptuelle : le curseur 0→100 % suit mieux l'oreille qu'un gain linéaire. */
function masterGain(settings: UiSoundSettings): number {
  if (!settings.enabled) return 0;
  return Math.pow(clamp01(settings.volume), 1.6) * (ducked ? 0.55 : 1);
}

function applyMasterGain() {
  if (master) master.gain.value = masterGain(getUiSoundSettings());
}

function ensureContext(): AudioContext | null {
  if (context) return context;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  master = context.createGain();
  master.connect(context.destination);
  applyMasterGain();
  window.addEventListener("avm-ui-sounds-changed", applyMasterGain);
  window.addEventListener("storage", applyMasterGain);
  return context;
}

function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Forme à callbacks : compatible avec les moteurs web plus anciens (WebKit).
  return new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
}

function load(id: UiSoundId): Promise<AudioBuffer | null> {
  const cached = buffers.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(id);
  if (pending) return pending;
  const ctx = ensureContext();
  if (!ctx) return Promise.resolve(null);
  const promise = fetch(`sounds/ui/${id}.wav`)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
    .then((data) => decode(ctx, data))
    .then((buffer) => {
      buffers.set(id, buffer);
      return buffer;
    })
    .catch(() => null)
    .finally(() => loading.delete(id));
  loading.set(id, promise);
  return promise;
}

/**
 * « Arme » le moteur : à appeler au premier geste de l'utilisateur (les
 * navigateurs interdisent de démarrer l'audio avant). Crée le contexte,
 * le réveille et précharge tous les sons.
 */
export function armUiSounds(): void {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  for (const id of UI_SOUND_IDS) void load(id);
}

/** Baisse le volume des sons d'interface (ex. pendant la lecture d'une vidéo). */
export function setUiSoundsDucked(value: boolean): void {
  ducked = value;
  applyMasterGain();
}

export function playUiSound(id: UiSoundId, options: { volume?: number } = {}): void {
  const settings = getUiSoundSettings();
  if (!settings.enabled || settings.volume <= 0) return;
  if (id === "hover" && !settings.hover) return;
  if (id === "welcome" && !settings.welcome) return;
  const now = performance.now();
  const gap = MIN_GAP_MS[id] ?? DEFAULT_GAP_MS;
  if (now - (lastPlayed.get(id) ?? -Infinity) < gap) return;
  lastPlayed.set(id, now);

  const ctx = ensureContext();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  const start = (buffer: AudioBuffer) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // ±1,5 % de hauteur : un même son répété ne devient pas mécanique.
    if (id !== "welcome" && id !== "unlock" && id !== "success") {
      source.playbackRate.value = 1 + (Math.random() - 0.5) * 0.03;
    }
    const gain = ctx.createGain();
    gain.gain.value = clamp01(options.volume ?? 1);
    source.connect(gain);
    gain.connect(master!);
    source.start();
  };

  const ready = buffers.get(id);
  if (ready) {
    start(ready);
    return;
  }
  // Premier usage avant la fin du préchargement : on joue dès que prêt, sauf si
  // l'attente est trop longue — un clic en retard serait pire que le silence,
  // alors qu'une signature de connexion ou un déverrouillage restent bienvenus.
  const asked = performance.now();
  const maxLate = id === "welcome" || id === "unlock" || id === "success" ? 1500 : 300;
  void load(id).then((buffer) => {
    if (buffer && performance.now() - asked < maxLate) start(buffer);
  });
}

/**
 * À appeler UNE fois au démarrage de l'application : arme le moteur au tout
 * premier geste, y compris sur l'écran de connexion (avant que l'AppShell, qui
 * porte les écouteurs de sons, soit monté) — la signature de connexion en a besoin.
 */
export function installUiSoundArming(): void {
  const arm = () => {
    armUiSounds();
    window.removeEventListener("pointerdown", arm, true);
    window.removeEventListener("keydown", arm, true);
  };
  window.addEventListener("pointerdown", arm, true);
  window.addEventListener("keydown", arm, true);
}
