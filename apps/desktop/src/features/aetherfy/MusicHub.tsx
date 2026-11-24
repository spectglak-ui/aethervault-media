import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlaylistCover } from "./PlaylistCover";
import {
  ArrowLeft, ImagePlus, ListMusic, Music2, Pause, Play, Plus, Shuffle, SkipBack, SkipForward, X,
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
  /** Image choisie par l'utilisateur (data URL). */
  cover?: string | null;
  /** Vignettes des 4 premiers titres : image par défaut (mosaïque). */
  previews?: string[];
  count: number;
  local?: boolean;
}
export interface MusicSubscription {
  id: string;
  name: string;
  cover?: string | null;
  kind: "channel" | "playlist";
}
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
  /** Page de résultats (titres, playlists, albums, artistes…) : remplace les panneaux quand on cherche. */
  searchView?: ReactNode;
  /** Un ajout par URL est en cours. */
  following?: boolean;
  onPlayTrack: (id: string) => void;
  onPlayAll: () => void;
  onShuffle: () => void;
  onToggleLike: (id: string) => void;
  onCreatePlaylist: (name: string) => void;
  onOpenPlaylist: (id: string) => void;
  onOpenSubscription: (id: string) => void;
  /** `false` si l'ajout a échoué (l'adresse saisie est alors conservée). */
  onFollowUrl: (url: string) => void | Promise<boolean | void>;
  /** Retour : ferme la recherche en cours, sinon revient au choix Vidéo / Musique. */
  onBack?: () => void;
  /** Choisir (`File`) ou retirer (`null`) l'image d'une playlist locale. */
  onSetPlaylistCover?: (id: string, file: File | null) => void | Promise<void>;
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
  const coverInput = useRef<HTMLInputElement>(null);
  const [coverTarget, setCoverTarget] = useState<string | null>(null);

  const pct =
    p.progress && p.progress.duration > 0
      ? Math.min(100, Math.round((p.progress.position / p.progress.duration) * 100))
      : 0;

  const topArtists = useMemo(() => {
    const map = new Map<string, { name: string; cover: string | null; count: number }>();
    for (const t of p.tracks) {
      if (!t.artist) continue; // artiste inconnu : on ne l'invente pas
      const key = t.artist;
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
              ? `${p.current.title}${p.current.artist ? ` — ${p.current.artist}` : ""} · ${p.current.duration}`
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
        {p.onBack && (
          <button
            type="button"
            className="avm-mh-btn avm-mh-btn--small"
            onClick={p.onBack}
            title={p.query.trim() ? "Fermer la recherche" : "Retour au choix Vidéo / Musique"}
          >
            <ArrowLeft size={14} /> Retour
          </button>
        )}
        <input
          className="avm-mh-search"
          type="search"
          placeholder="Rechercher un artiste, un album, un titre, une playlist…"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
        />
      </div>

      <div className="avm-mh-grid">
        {/* ── Colonne principale ─────────────────────────────── */}
        <div className="avm-mh-main">
          {p.searchView ? p.searchView : (<>
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
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file && coverTarget) void p.onSetPlaylistCover?.(coverTarget, file);
              }}
            />
            {p.playlists.length === 0 ? (
              <p className="avm-mh-empty">Aucune playlist locale — créez-en une ci-dessus.</p>
            ) : (
              <div className="avm-mh-playlists">
                {p.playlists.map((pl) => (
                  <div key={pl.id} className="avm-mh-pl-item">
                    <button className="avm-mh-pl" onClick={() => p.onOpenPlaylist(pl.id)}>
                      <PlaylistCover custom={pl.cover} previews={pl.previews} />
                      <strong>{pl.name}</strong>
                      <small>{pl.count} piste{pl.count > 1 ? "s" : ""}{pl.local ? " · locale" : ""}</small>
                    </button>
                    {p.onSetPlaylistCover && (
                      <span className="avm-mh-pl__tools">
                        <button
                          type="button"
                          className="avm-mh-pl__tool"
                          title="Choisir une image"
                          aria-label={`Choisir une image pour ${pl.name}`}
                          onClick={() => {
                            setCoverTarget(pl.id);
                            coverInput.current?.click();
                          }}
                        >
                          <ImagePlus size={14} />
                        </button>
                        {pl.cover && (
                          <button
                            type="button"
                            className="avm-mh-pl__tool"
                            title="Retirer l'image"
                            aria-label={`Retirer l'image de ${pl.name}`}
                            onClick={() => void p.onSetPlaylistCover?.(pl.id, null)}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
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
                    <span className={`avm-mh-cover${s.cover ? "" : " avm-mh-cover--void"}`}>
                      {s.cover ? <img src={s.cover} alt="" loading="lazy" draggable={false} /> : <Music2 size={26} />}
                    </span>
                    <strong>{s.name}</strong>
                    <small>{s.kind === "channel" ? "Chaîne suivie" : "Playlist suivie"}</small>
                  </button>
                ))}
              </div>
            )}
            <form
              className="avm-mh-follow"
              onSubmit={async (e) => {
                e.preventDefault();
                const url = followUrl.trim();
                if (!url || p.following) return;
                const ok = await p.onFollowUrl(url);
                if (ok !== false) setFollowUrl("");
              }}
            >
              <input
                placeholder="Ou collez l'URL d'une chaîne / playlist (YouTube…)"
                value={followUrl}
                onChange={(e) => setFollowUrl(e.target.value)}
              />
              <button className="avm-mh-btn avm-mh-btn--small" type="submit" disabled={!followUrl.trim() || p.following}>
                <Plus size={13} /> {p.following ? "Ajout…" : "Suivre"}
              </button>
            </form>
          </section>
          </>)}
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

          {topArtists.length > 0 && (
            <section className="avm-mh-panel">
              <header className="avm-mh-head">
                <h2>Top artistes</h2>
                <span className="avm-mh-head__hint">depuis vos pistes</span>
              </header>
              <ul className="avm-mh-toplist">
                {topArtists.map((a) => {
                  const art = artistArt[a.name] ?? artistArtCache.get(a.name) ?? null;
                  return (
                    <li key={a.name}>
                      <button
                        type="button"
                        className="avm-mh-toprow"
                        title={`Rechercher ${a.name}`}
                        onClick={() => p.onQuery(a.name)}
                      >
                        {art ? (
                          <img src={art} alt="" loading="lazy" />
                        ) : a.cover ? (
                          <Cover src={a.cover} fallback={null} />
                        ) : (
                          <span className="avm-mh-toprow__void"><Music2 size={16} /></span>
                        )}
                        <span>
                          <strong>{a.name}</strong>
                          <small>{a.count} piste{a.count > 1 ? "s" : ""}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}