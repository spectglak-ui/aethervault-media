/**
0.8.0 — Bibliothèque personnelle de fournisseurs de médias.
Centralise les liens (streaming, anime, TV, musique…) + identifiants
optionnels (nom d'utilisateur, e-mail, mot de passe) avec copie rapide.
Stockage local (localStorage), comme les autres réglages de l'app ;
événement `avm-providers-changed` pour rafraîchir Accueil + page dédiée.
Les liens par défaut sont semés au premier lancement uniquement.
0.8.x — Loadix (https://loadix.fun/) est le site RECOMMANDÉ, placé en
tête par défaut (migration unique pour les bibliothèques existantes) ;
l'ordre reste entièrement personnalisable (glisser-déposer + flèches).
*/
import { openUrl } from "@tauri-apps/plugin-opener";

export type ProviderCategory =
  | "streaming"
  | "anime"
  | "tv"
  | "music"
  | "download"
  | "other";

export const PROVIDER_CATEGORIES: { key: ProviderCategory; label: string }[] = [
  { key: "streaming", label: "Streaming" },
  { key: "anime", label: "Anime & manga" },
  { key: "tv", label: "TV & replay" },
  { key: "music", label: "Musique & vidéo" },
  { key: "download", label: "Téléchargement" },
  { key: "other", label: "Autre" },
];

export interface ProviderEntry {
  id: string;
  name: string;
  url: string;
  category: ProviderCategory;
  color: string;
  username: string;
  email: string;
  password: string;
  notes: string;
  builtin?: boolean;
  /** Site recommandé par AetherVault (badge étoile). */
  recommended?: boolean;
  createdAt: number;
}

export const PROVIDERS_CHANGED = "avm-providers-changed";
const LS_KEY = "avm-providers-library";
const RECO_FLAG = "avm-providers-reco-loadix-v1";

const PALETTE = [
  "#7c5cff", "#00c2ff", "#ff4d6d", "#1db954",
  "#f5a623", "#ff6600", "#e8365d", "#36e86d",
];

const BRAND_COLORS: Record<string, string> = {
  "loadix.fun": "#00e5b0",
  "netflix.com": "#E50914",
  "primevideo.com": "#00A8E1",
  "disneyplus.com": "#113CCF",
  "crunchyroll.com": "#F47521",
  "animationdigitalnetwork.com": "#009FE3",
  "youtube.com": "#FF0000",
  "spotify.com": "#1DB954",
  "arte.tv": "#FF6600",
  "france.tv": "#E4002B",
  "canalplus.com": "#000000",
  "plex.tv": "#E5A00D",
};

type DefaultSeed = Omit<ProviderEntry, "id" | "createdAt">;

const DEFAULT_PROVIDERS: DefaultSeed[] = [
  { name: "Loadix", url: "https://loadix.fun/", category: "streaming", color: "#00e5b0", username: "", email: "", password: "", notes: "", builtin: true, recommended: true },
  { name: "Netflix", url: "https://www.netflix.com", category: "streaming", color: "#E50914", username: "", email: "", password: "", notes: "", builtin: true },
  { name: "Prime Video", url: "https://www.primevideo.com", category: "streaming", color: "#00A8E1", username: "", email: "", password: "", notes: "", builtin: true },
  { name: "Disney+", url: "https://www.disneyplus.com", category: "streaming", color: "#113CCF", username: "", email: "", password: "", notes: "", builtin: true },
  { name: "Crunchyroll", url: "https://www.crunchyroll.com", category: "anime", color: "#F47521", username: "", email: "", password: "", notes: "", builtin: true },
  { name: "ADN", url: "https://animationdigitalnetwork.com", category: "anime", color: "#009FE3", username: "", email: "", password: "", notes: "", builtin: true },
  { name: "YouTube", url: "https://www.youtube.com", category: "music", color: "#FF0000", username: "", email: "", password: "", notes: "", builtin: true },
  { name: "Spotify", url: "https://open.spotify.com", category: "music", color: "#1DB954", username: "", email: "", password: "", notes: "", builtin: true },
  { name: "Arte", url: "https://www.arte.tv", category: "tv", color: "#FF6600", username: "", email: "", password: "", notes: "", builtin: true },
  { name: "france.tv", url: "https://www.france.tv", category: "tv", color: "#E4002B", username: "", email: "", password: "", notes: "", builtin: true },
];

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function withProtocol(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function providerHost(url: string): string {
  try {
    return new URL(withProtocol(url)).hostname.replace(/^www\./, "");
  } catch {
    return url.trim();
  }
}

export function faviconUrls(host: string): string[] {
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
  ];
}

export function brandColor(url: string): string {
  const host = providerHost(url);
  for (const [domain, color] of Object.entries(BRAND_COLORS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return color;
  }
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function normalize(raw: unknown): ProviderEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || typeof r.url !== "string") return null;
  if (!r.name.trim() || !r.url.trim()) return null;
  const category = PROVIDER_CATEGORIES.some((c) => c.key === r.category)
    ? (r.category as ProviderCategory)
    : "other";
  return {
    id: typeof r.id === "string" && r.id ? r.id : uid(),
    name: r.name.trim(),
    url: withProtocol(r.url),
    category,
    color: typeof r.color === "string" && r.color ? r.color : brandColor(r.url),
    username: typeof r.username === "string" ? r.username : "",
    email: typeof r.email === "string" ? r.email : "",
    password: typeof r.password === "string" ? r.password : "",
    notes: typeof r.notes === "string" ? r.notes : "",
    builtin: r.builtin === true,
    recommended: r.recommended === true,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
  };
}

function read(): ProviderEntry[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map(normalize).filter((e): e is ProviderEntry => e !== null);
  } catch {
    return null;
  }
}

function write(list: ProviderEntry[], emit = true): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // best-effort
  }
  if (emit) window.dispatchEvent(new Event(PROVIDERS_CHANGED));
}

/** Premier lancement : sème les défauts (Loadix en tête). Ensuite,
respecte la liste utilisateur ; migration unique : injecte Loadix en
tête des bibliothèques déjà existantes (une seule fois — si l'utilisateur
le retire ensuite, il ne revient pas tout seul). */
export function getProviders(): ProviderEntry[] {
  const existing = read();
  if (existing) {
    try {
      if (!localStorage.getItem(RECO_FLAG)) {
        localStorage.setItem(RECO_FLAG, "1");
        const idx = existing.findIndex((p) => providerHost(p.url) === "loadix.fun");
        if (idx >= 0) {
          if (!existing[idx].recommended) {
            const next = existing.map((p, i) => (i === idx ? { ...p, recommended: true } : p));
            write(next, false);
            return next;
          }
          return existing;
        }
        const entry: ProviderEntry = {
          ...DEFAULT_PROVIDERS[0],
          id: uid(),
          createdAt: Date.now(),
          recommended: true,
        };
        const next = [entry, ...existing];
        write(next, false);
        return next;
      }
    } catch {
      // best-effort
    }
    return existing;
  }
  const now = Date.now();
  const seeded = DEFAULT_PROVIDERS.map((d, i) => ({ ...d, id: `${uid()}-${i}`, createdAt: now + i }));
  write(seeded, false);
  try {
    localStorage.setItem(RECO_FLAG, "1");
  } catch {
    // best-effort
  }
  return seeded;
}

export function subscribeProviders(callback: () => void): () => void {
  window.addEventListener(PROVIDERS_CHANGED, callback);
  return () => window.removeEventListener(PROVIDERS_CHANGED, callback);
}

export function addProvider(input: Omit<ProviderEntry, "id" | "createdAt">): ProviderEntry {
  const entry: ProviderEntry = { ...input, id: uid(), createdAt: Date.now() };
  write([...getProviders(), entry]);
  return entry;
}

export function updateProvider(id: string, patch: Partial<ProviderEntry>): void {
  write(getProviders().map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)));
}

export function removeProvider(id: string): { entry: ProviderEntry; index: number } | null {
  const list = getProviders();
  const index = list.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const [entry] = list.splice(index, 1);
  write(list);
  return { entry, index };
}

export function insertProviderAt(entry: ProviderEntry, index: number): void {
  const list = getProviders();
  list.splice(Math.max(0, Math.min(index, list.length)), 0, entry);
  write(list);
}

export function moveProvider(fromId: string, toId: string): void {
  const list = getProviders();
  const from = list.findIndex((p) => p.id === fromId);
  const to = list.findIndex((p) => p.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  write(list);
}

/** 0.8.x — déplace une entrée de `delta` crans (flèches ↑↓ des cartes). */
export function moveProviderBy(id: string, delta: number): void {
  const list = getProviders();
  const from = list.findIndex((p) => p.id === id);
  if (from < 0) return;
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  write(list);
}

/** Ré-ajoute les liens par défaut manquants (sans toucher aux entrées utilisateur). */
export function restoreDefaults(): number {
  const list = getProviders();
  const hosts = new Set(list.map((p) => providerHost(p.url)));
  const now = Date.now();
  const missing = DEFAULT_PROVIDERS.filter((d) => !hosts.has(providerHost(d.url))).map(
    (d, i) => ({ ...d, id: `${uid()}-r${i}`, createdAt: now + i })
  );
  if (missing.length > 0) write([...list, ...missing]);
  return missing.length;
}

export function exportProvidersJson(): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), providers: getProviders() }, null, 2);
}

export function importProvidersJson(text: string): number {
  const parsed: unknown = JSON.parse(text);
  const rawList = Array.isArray(parsed)
    ? parsed
    : (parsed as { providers?: unknown[] })?.providers;
  if (!Array.isArray(rawList)) throw new Error("Format invalide : liste de fournisseurs attendue.");
  const entries = rawList.map(normalize).filter((e): e is ProviderEntry => e !== null);
  if (entries.length === 0) throw new Error("Aucun fournisseur valide dans ce fichier.");
  write(entries);
  return entries.length;
}

/** Ouvre le lien dans le navigateur par défaut de la machine (repli webview). */
export async function openExternal(url: string): Promise<void> {
  const target = withProtocol(url);
  try {
    await openUrl(target);
  } catch {
    window.open(target, "_blank", "noopener,noreferrer");
  }
}

/** Copie presse-papiers avec repli execCommand ; renvoie le succès. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}