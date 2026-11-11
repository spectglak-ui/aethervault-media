import { useEffect, useMemo, useState } from "react";
import {
  ListMusic, Music2, Pause, Play, Plus, Shuffle, SkipBack, SkipForward,
} from "lucide-react";

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  duration: string;
  cover?: string | null;
  /** Repli si `cover` (maxres) n'existe pas pour cette vidéo. */
  coverFallback?: string | null;
  source: "youtube" | "dailymotion";
  liked?: boolean;
}
export interface MusicPlaylist {
  id: string;
  name: string;
  cover?: string | null;
  count: number;
  local?: boolean;
}
export interface MusicSubscription {
  id: string;
  name: string;
  cover?: string | null;
  kind: "channel" | "playlist";
}
export type MusicSource = "all" | "youtube" | "dailymotion";

export interface MusicHubProps {
  tracks: MusicTrack[];
  playlists: MusicPlaylist[];
  subscriptions: MusicSubscription[];
  current: MusicTrack | null;
  playing?: boolean;
  progress?: { position: number; duration: number } | null;
  queue?: MusicTrack[];
  query: string;
  onQuery: (q: string) => void;
  source: MusicSource;
  onSource: (s: MusicSource) => void;
  onPlayTrack: (id: string) => void;
  onPlayAll: () => void;
  onShuffle: () => void;
  onToggleLike: (id: string) => void;
  onCreatePlaylist: (name: string) => void;
  onOpenPlaylist: (id: string) => void;
  onOpenSubscription: (id: string) => void;
  onFollowUrl: (url: string) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
}

/* 0.8.0 — portraits d'artistes via iTunes Search (gratuit, sans clé).
   Cache de session ; repli silencieux sur la pochette si hors ligne. */
const artistArtCache = new Map<string, string | null>();
async function fetchArtistArt(name: string): Promise<string | null> {
  if (artistArtCache.has(name)) return artistArtCache.get(name) ?? null;
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=1`
    );
    if (!res.ok) throw new Error("http");
    const json = (await res.json()) as { results?: { artworkUrl100?: string }[] };
    const art = json.results?.[0]?.artworkUrl100?.replace("100x100bb", "400x400bb") ?? null;
    artistArtCache.set(name, art);
    return art;
  } catch {
    artistArtCache.set(name, null);
    return null;
  }
}

/** Image avec chaîne de repli (maxres → hq → vignette stockée). */
function Cover({
  src,
  fallback,
  className,
}: {
  src?: string | null;
  fallback?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  const url = failed ? (fallback ?? null) : (src ?? null);
  if (!url) return null;
  return <img className={className} src={url} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

/** Égaliseur CSS animé (mis en pause si `paused`). */
function Equalizer({ paused }: { paused?: boolean }) {
  return (
    <span className={`avm-mh-eq${paused ? " avm-mh-eq--paused" : ""}`} aria-hidden="true">
      <span /><span /><span /><span />
    </span>
  );
}

function fmtTime(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 0.8.0 — AetherFy Musique v4 : wordmark de marque (Major Mono Display)
 * en taille raisonnable, pochettes HD avec repli, portraits d'artistes
 * iTunes Search, panneaux verre (fond global visible).
 */
export function MusicHub(p: MusicHubProps) {
  const [newName, setNewName] = useState("");
  const [followUrl, setFollowUrl] = useState("");
  const [artistArt, setArtistArt] = useState<Record<string, string | null>>({});

  const pct =
    p.progress && p.progress.duration > 0
      ? Math.min(100, Math.round((p.progress.position / p.progress.duration) * 100))
      : 0;

  const topArtists = useMemo(() => {
    const map = new Map<string, { name: string; cover: string | null; count: number }>();
    for (const t of p.tracks) {
      const key = t.artist || "AetherFy";
      const cur = map.get(key);
      if (cur) cur.count += 1;
      else map.set(key, { name: key, cover: t.cover ?? null, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [p.tracks]);

  // Portraits d'artistes (iTunes) — une seule requête par artiste et par session.
  useEffect(() => {
    let alive = true;
    for (const a of topArtists) {
      if (artistArtCache.has(a.name)) continue;
      void fetchArtistArt(a.name).then((art) => {
        if (alive) setArtistArt((prev) => ({ ...prev, [a.name]: art }));
      });
    }
    return () => {
      alive = false;
    };
  }, [topArtists]);

  const heroTrack = p.current ?? p.tracks[0] ?? null;

  return (
    <div className="avm-mh">
      {/* ── Héro ─────────────────────────────────────────────── */}
      <section className="avm-mh-hero">
        {heroTrack?.cover && (
          <Cover className="avm-mh-hero__art" src={heroTrack.cover} fallback={heroTrack.coverFallback} />
        )}
        <div className="avm-mh-hero__fade" aria-hidden="true" />
        <div className="avm-mh-hero__inner">
          <span className="avm-mh-kicker">Mode musique</span>
          <h1 className="avm-mh-hero__title">
            <span className="avm-brand-aetherfy">AetherFy</span>
            <span className="avm-mh-hero__title-suffix">Musique</span>
          </h1>
          <p className="avm-mh-hero__sub">
            {p.current
              ? `${p.current.title} — ${p.current.artist} · ${p.current.duration}`
              : "Playlists, abonnements et flux audio — sans quitter AetherVault."}
          </p>
          <div className="avm-mh-hero__actions">
            <button className="avm-mh-btn avm-mh-btn--primary" onClick={p.onPlayAll}>
              <Play size={14} fill="currentColor" /> Écouter
            </button>
            <button
              className="avm-mh-btn avm-mh-btn--round"
              onClick={p.onShuffle}
              aria-label="Lecture aléatoire"
              title="Lecture aléatoire"
            >
              <Shuffle size={15} />
            </button>
            <span className="avm-mh-hero__count">
              <ListMusic size={14} /> {p.tracks.length} piste{p.tracks.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </section>

      {/* ── Barre d'outils ───────────────────────────────────── */}
      <div className="avm-mh-toolbar">
        <input
          className="avm-mh-search"
          type="search"
          placeholder="Rechercher vidéos, chaînes, playlists…"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
        />
        <div className="avm-mh-chips">
          {(["all", "youtube", "dailymotion"] as MusicSource[]).map((s) => (
            <button
              key={s}
              className={`avm-mh-chip${p.source === s ? " avm-mh-chip--active" : ""}`}
              onClick={() => p.onSource(s)}
            >
              {s === "all" ? "Toutes" : s === "youtube" ? "YouTube" : "Dailymotion"}
            </button>
          ))}
        </div>
      </div>

      <div className="avm-mh-grid">
        {/* ── Colonne principale ─────────────────────────────── */}
        <div className="avm-mh-main">
          {topArtists.length > 0 && (
            <section className="avm-mh-panel">
              <header className="avm-mh-head">
                <h2>Top artistes</h2>
                <span className="avm-mh-head__hint">depuis vos pistes</span>
              </header>
              <div className="avm-mh-artists">
                {topArtists.map((a) => {
                  const art = artistArt[a.name] ?? artistArtCache.get(a.name) ?? null;
                  return (
                    <div key={a.name} className="avm-mh-artist">
                      {art ? (
                        <img src={art} alt="" loading="lazy" />
                      ) : a.cover ? (
                        <Cover src={a.cover} fallback={null} />
                      ) : (
                        <span className="avm-mh-artist__void"><Music2 size={20} /></span>
                      )}
                      <strong>{a.name}</strong>
                      <small>{a.count} piste{a.count > 1 ? "s" : ""}</small>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="avm-mh-panel">
            <header className="avm-mh-head">
              <h2>Mes playlists</h2>
              <span className="avm-mh-create">
                <input
                  placeholder="Nouvelle playlist…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) {
                      p.onCreatePlaylist(newName.trim());
                      setNewName("");
                    }
                  }}
                />
                <button
                  className="avm-mh-btn avm-mh-btn--small"
                  disabled={!newName.trim()}
                  onClick={() => { p.onCreatePlaylist(newName.trim()); setNewName(""); }}
                >
                  <Plus size={13} /> Créer
                </button>
              </span>
            </header>
            {p.playlists.length === 0 ? (
              <p className="avm-mh-empty">Aucune playlist locale — créez-en une ci-dessus.</p>
            ) : (
              <div className="avm-mh-playlists">
                {p.playlists.map((pl) => (
                  <button key={pl.id} className="avm-mh-pl" onClick={() => p.onOpenPlaylist(pl.id)}>
                    {pl.cover ? (
                      <img src={pl.cover} alt="" loading="lazy" />
                    ) : (
                      <span className="avm-mh-pl__void"><ListMusic size={22} /></span>
                    )}
                    <strong>{pl.name}</strong>
                    <small>{pl.count} piste{pl.count > 1 ? "s" : ""}{pl.local ? " · locale" : ""}</small>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="avm-mh-panel">
            <header className="avm-mh-head"><h2>Abonnements</h2></header>
            {p.subscriptions.length === 0 ? (
              <p className="avm-mh-empty">Aucun abonnement — suivez une chaîne ou une playlist ci-dessous.</p>
            ) : (
              <div className="avm-mh-subs">
                {p.subscriptions.map((s) => (
                  <button key={s.id} className="avm-mh-sub" onClick={() => p.onOpenSubscription(s.id)}>
                    {s.cover ? (
                      <img src={s.cover} alt="" loading="lazy" />
                    ) : (
                      <span className="avm-mh-sub__void"><Music2 size={18} /></span>
                    )}
                    <strong>{s.name}</strong>
                    <small>{s.kind === "channel" ? "Chaîne suivie" : "Playlist suivie"}</small>
                  </button>
                ))}
              </div>
            )}
            <form
              className="avm-mh-follow"
              onSubmit={(e) => { e.preventDefault(); if (followUrl.trim()) { p.onFollowUrl(followUrl.trim()); setFollowUrl(""); } }}
            >
              <input
                placeholder="Ou collez l'URL d'une chaîne / playlist (YouTube, Dailymotion, Vimeo…)"
                value={followUrl}
                onChange={(e) => setFollowUrl(e.target.value)}
              />
              <button className="avm-mh-btn avm-mh-btn--small" type="submit" disabled={!followUrl.trim()}>
                <Plus size={13} /> Suivre
              </button>
            </form>
          </section>
        </div>

        {/* ── Rail latéral : lecteur + file ──────────────────── */}
        <aside className="avm-mh-rail">
          <section className="avm-mh-panel avm-mh-now">
            <header className="avm-mh-head">
              <h2>Lecteur</h2>
              <Equalizer paused={!p.playing} />
            </header>
            {p.current ? (
              <>
                <Cover className="avm-mh-now__cover" src={p.current.cover} fallback={p.current.coverFallback} />
                <strong className="avm-mh-now__title">{p.current.title}</strong>
                <small className="avm-mh-now__artist">{p.current.artist}</small>
                <div className="avm-mh-now__progress">
                  <span className="avm-mh-now__time">{fmtTime(p.progress?.position ?? 0)}</span>
                  <div className="avm-mh-now__bar"><span style={{ width: `${pct}%` }} /></div>
                  <span className="avm-mh-now__time">{fmtTime(p.progress?.duration ?? 0)}</span>
                </div>
                <div className="avm-mh-now__deck">
                  <button onClick={p.onShuffle} aria-label="Aléatoire"><Shuffle size={14} /></button>
                  <button onClick={p.onPrev} aria-label="Piste précédente"><SkipBack size={16} /></button>
                  <button className="avm-mh-now__play" onClick={p.onTogglePlay} aria-label="Lecture / pause">
                    {p.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                  </button>
                  <button onClick={p.onNext} aria-label="Piste suivante"><SkipForward size={16} /></button>
                </div>
              </>
            ) : (
              <p className="avm-mh-empty">Rien en lecture pour le moment.</p>
            )}
          </section>

          {(p.queue?.length ?? 0) > 0 && (
            <section className="avm-mh-panel">
              <header className="avm-mh-head"><h2>À suivre</h2></header>
              <ul className="avm-mh-queue">
                {p.queue!.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <button className="avm-mh-queue__row" onClick={() => p.onPlayTrack(t.id)}>
                      {t.cover ? (
                        <Cover src={t.cover} fallback={t.coverFallback} />
                      ) : (
                        <span className="avm-mh-queue__void"><Music2 size={12} /></span>
                      )}
                      <span><strong>{t.title}</strong><small>{t.artist}</small></span>
                      <span className="avm-mh-track__time">{t.duration}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}