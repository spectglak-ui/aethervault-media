import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, Bookmark, Sparkles, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { VaultTubeVideo, VaultTubeSubscription } from "../vaulttube/api";
import { vaultTubeApi } from "../vaulttube/api";
import { AetherFyVideoCard } from "./AetherFyVideoCard";
import { usePlayer } from "../../player/PlayerContext";

type ChipKey = "all" | "music" | "gaming" | "shorts" | "live" | "new";

const CHIPS: { key: ChipKey; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "music", label: "Musique" },
  { key: "gaming", label: "Jeux indépendants" },
  { key: "shorts", label: "Shorts" },
  { key: "live", label: "Directs" },
  { key: "new", label: "Nouveautés" },
];

/** Vidéo enrichie : rattachement à son abonnement + avatar de chaîne. */
export type AetherFyVideo = VaultTubeVideo & {
  channel?: string | null;
  views?: number | null;
  channelAvatar?: string | null;
  subId?: number;
};

function formatViews(views?: number | null): string {
  if (!views) return "";
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1).replace(".0", "")} M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(0)} k`;
  return String(views);
}

export function AetherFyHomePage() {
  const navigate = useNavigate();
  const { play } = usePlayer();
  const [subscriptions, setSubscriptions] = useState<VaultTubeSubscription[]>([]);
  const [videos, setVideos] = useState<AetherFyVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [chip, setChip] = useState<ChipKey>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const subs = await vaultTubeApi.listSubscriptions();
      const chunks = await Promise.all(
        subs.slice(0, 10).map(async (sub) => {
          try {
            const list = await vaultTubeApi.listVideos(sub.id);
            return list.map(
              (v): AetherFyVideo => ({
                ...v,
                channel: sub.name,
                channelAvatar: sub.thumbnail_url ?? null,
                subId: sub.id,
              })
            );
          } catch {
            return [] as AetherFyVideo[];
          }
        })
      );
      setSubscriptions(subs);
      setVideos(chunks.flat());
    } catch (err) {
      console.error("[AetherFy] Chargement échoué", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* 0.7.4 — Shorts 100% backend : lecture directe de `is_short` (peuplé
     à la sync Rust via l'onglet /shorts + heuristique durée ≤ 60s).
     Plus aucune sonde de miniature (fragile, coûteuse en réseau). */
  const isShort = useCallback((v: AetherFyVideo): boolean => v.is_short ?? false, []);

  const shorts = useMemo(() => videos.filter(isShort), [videos, isShort]);
  const normals = useMemo(() => videos.filter((v) => !isShort(v)), [videos, isShort]);

  const filtered = useMemo(() => {
    if (chip === "shorts") return shorts;
    let list = normals;
    if (chip === "music")
      list = list.filter((v) => /music|clip|album|song|lyric|\bmv\b/i.test(v.title));
    else if (chip === "gaming")
      list = list.filter((v) => /game|gameplay|speedrun|let'?s play|trailer/i.test(v.title));
    else if (chip === "live")
      list = list.filter((v) => /live|direct|stream/i.test(v.title));
    else if (chip === "new")
      list = [...list]
        .sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0))
        .slice(0, 12);
    return list;
  }, [normals, shorts, chip]);

  const heroVideo = normals[0];

  if (loading && videos.length === 0) {
    return <div className="afy-loader">Chargement du rêve…</div>;
  }

  return (
    <div>
      {/* CHIPS */}
      <div className="afy-chips">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`afy-chip${chip === c.key ? " afy-chip--active" : ""}`}
            onClick={() => setChip(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* HERO (vidéos normales uniquement) */}
      {heroVideo && chip === "all" && (
        <section className="afy-hero">
          {heroVideo.thumbnail_url && (
            <div
              className="afy-hero__backdrop"
              style={{ backgroundImage: `url(${heroVideo.thumbnail_url})` }}
            />
          )}
          <div className="afy-hero__scrim" />
          <div className="afy-hero__content">
            <span className="afy-hero__badge">
              <Sparkles size={12} /> À LA UNE
            </span>
            <h1 className="afy-hero__title">{heroVideo.title}</h1>
            <div className="afy-hero__meta">
              {heroVideo.channel ?? "Chaîne inconnue"}
              {heroVideo.views ? ` • ${formatViews(heroVideo.views)} vues` : ""}
            </div>
            <div className="afy-hero__actions">
              <button
                type="button"
                className="afy-btn-primary"
                onClick={() => {
                  play({
                    id: heroVideo.id,
                    title: heroVideo.title,
                    path: heroVideo.source
                      ? `${heroVideo.source}:${heroVideo.youtube_id}`
                      : heroVideo.youtube_id,
                    libraryId: -1,
                    isPrivate: false,
                  });
                  navigate(`/aetherfy/watch/${heroVideo.youtube_id}`);
                }}
              >
                <Play size={14} fill="#fff" /> Lire maintenant
              </button>
              <button type="button" className="afy-btn-secondary">
                <Bookmark size={14} /> Ma liste
              </button>
            </div>
          </div>
        </section>
      )}

      {/* RANGÉE SHORTS (backend-first) */}
      {chip === "all" && shorts.length > 0 && (
        <section className="afy-row">
          <h2 className="afy-row__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={18} style={{ color: "#ff2e63" }} /> Shorts
          </h2>
          <div className="afy-shorts-shelf">
            {shorts.slice(0, 12).map((v) => (
              <AetherFyVideoCard
                key={`short-${v.source}-${v.youtube_id}`}
                video={v}
                variant="short"
              />
            ))}
          </div>
        </section>
      )}

      {/* RANGÉES PAR ABONNEMENT (horizontales seulement) */}
      {chip === "all" &&
        subscriptions.slice(0, 4).map((sub) => (
          <SubscriptionRow
            key={sub.id}
            subscription={sub}
            videos={normals.filter((v) => v.subId === sub.id)}
            onOpenAll={() => navigate(`/aetherfy/subscription/${sub.id}`)}
          />
        ))}

      {/* GRILLE FILTRÉE */}
      {chip !== "all" && (
        <section className="afy-row">
          <h2 className="afy-row__title">{CHIPS.find((c) => c.key === chip)?.label ?? "Vidéos"}</h2>
          {filtered.length === 0 ? (
            <div className="afy-empty">
              <div className="afy-empty__title">Aucune vidéo dans cette catégorie</div>
              <div>Abonnez-vous à plus de chaînes pour enrichir le rêve.</div>
            </div>
          ) : (
            <div className={`afy-grid${chip === "shorts" ? " afy-grid--shorts" : ""}`}>
              {filtered.slice(0, 24).map((v) => (
                <AetherFyVideoCard
                  key={`${v.source}-${v.youtube_id}`}
                  video={v}
                  variant={chip === "shorts" ? "short" : "normal"}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SubscriptionRow({
  subscription,
  videos,
  onOpenAll,
}: {
  subscription: VaultTubeSubscription;
  videos: AetherFyVideo[];
  onOpenAll: () => void;
}) {
  if (videos.length === 0) return null;
  return (
    <section className="afy-row">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 className="afy-row__title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {subscription.thumbnail_url && (
            <img src={subscription.thumbnail_url} alt="" className="afy-row__avatar" />
          )}
          {subscription.name}
        </h2>
        <button type="button" className="afy-btn-secondary" onClick={onOpenAll}>
          Tout voir →
        </button>
      </div>
      <div className="afy-grid">
        {videos.slice(0, 8).map((v) => (
          <AetherFyVideoCard key={`${v.source}-${v.youtube_id}`} video={v} />
        ))}
      </div>
    </section>
  );
}