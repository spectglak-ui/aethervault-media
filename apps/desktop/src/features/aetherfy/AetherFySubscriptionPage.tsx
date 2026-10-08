import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, RefreshCw, Users } from "lucide-react";
import type { VaultTubeSubscription, VaultTubeVideo } from "../vaulttube/api";
import { vaultTubeApi } from "../vaulttube/api";
import { AetherFyVideoCard } from "./AetherFyVideoCard";
import { isShortByMeta } from "./shorts";

/**
 * 0.7.2 (Phase 2) â€” page chaÃ®ne/abonnement : en-tÃªte profil (avatar rÃ©el,
 * compteurs), bouton de synchronisation manuelle, grille des vidÃ©os
 * normales + rangÃ©e Shorts sÃ©parÃ©e (mÃªme rÃ¨gle de dÃ©tection que l'accueil).
 */
export function AetherFySubscriptionPage() {
  const { id } = useParams<{ id: string }>();
  const subId = Number(id);

  const [subscription, setSubscription] = useState<VaultTubeSubscription | null>(null);
  const [videos, setVideos] = useState<VaultTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subs, vids] = await Promise.all([
        vaultTubeApi.listSubscriptions(),
        vaultTubeApi.listVideos(subId),
      ]);
      setSubscription(subs.find((s) => s.id === subId) ?? null);
      setVideos(vids);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [subId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      // Nom de mÃ©thode Ã  aligner sur features/vaulttube/api.ts si besoin
      // (refreshSubscription / refresh / syncSubscription).
      await vaultTubeApi.refreshSubscription(subId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synchronisation impossible.");
    } finally {
      setSyncing(false);
    }
  };

  const shorts = useMemo(
  () => videos.filter(isShortByMeta),
  [videos]
);

const normals = useMemo(
  () => videos.filter((v) => !isShortByMeta(v)),
  [videos]
);

  if (loading && videos.length === 0) {
    return <div className="afy-loader">Chargement de la chaÃ®neâ€¦</div>;
  }

  return (
    <div>
      {subscription && (
        <header className="afy-sub-head">
          {subscription.thumbnail_url ? (
            <img className="afy-sub-head__avatar" src={subscription.thumbnail_url} alt="" />
          ) : (
            <div className="afy-sub-head__avatar afy-sub-head__avatar--fallback">
              {subscription.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="afy-sub-head__info">
            <h1 className="afy-sub-head__name">
              {subscription.name}
              <CheckCircle2 size={16} className="afy-sub-head__verified" />
            </h1>
            <div className="afy-sub-head__meta">
              <Users size={13} /> {videos.length} vidÃ©o(s) â€¢ {shorts.length} short(s)
            </div>
          </div>
          <button type="button" className="afy-btn-secondary" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? "afy-spin" : undefined} />
            {syncing ? "Synchronisationâ€¦" : "Synchroniser"}
          </button>
        </header>
      )}

      {error && (
        <div className="afy-empty">
          <div className="afy-empty__title">{error}</div>
        </div>
      )}

      {normals.length > 0 && (
        <section className="afy-row">
          <h2 className="afy-row__title">VidÃ©os</h2>
          <div className="afy-grid">
            {normals.map((v) => (
              <AetherFyVideoCard
                key={`${v.source}-${v.youtube_id}`}
                video={{
                  ...v,
                  channel: subscription?.name ?? null,
                  channelAvatar: subscription?.thumbnail_url ?? null,
                }}
              />
            ))}
          </div>
        </section>
      )}

      {shorts.length > 0 && (
        <section className="afy-row">
          <h2 className="afy-row__title">Shorts</h2>
          <div className="afy-shorts-shelf">
            {shorts.map((v) => (
              <AetherFyVideoCard
                key={`s-${v.source}-${v.youtube_id}`}
                video={{
                  ...v,
                  channel: subscription?.name ?? null,
                  channelAvatar: subscription?.thumbnail_url ?? null,
                }}
                variant="short"
              />
            ))}
          </div>
        </section>
      )}

      {videos.length === 0 && !loading && !error && (
        <div className="afy-empty">
          <div className="afy-empty__title">Aucune vidÃ©o synchronisÃ©e</div>
          <div>Lancez une synchronisation pour rÃ©cupÃ©rer les derniÃ¨res vidÃ©os de la chaÃ®ne.</div>
        </div>
      )}
    </div>
  );
}
