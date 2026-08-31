import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3, Trash2 } from "lucide-react";
import { Button, EmptyState, PageHeader } from "@aethervault/ui-kit";
import type { Category, TitleSummary } from "@aethervault/shared-types";
import { titleApi, type WatchSession, type WatchStats } from "../features/title/api";
import { categoryApi } from "../features/category/api";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/**
Time Capsule (Étape 8) : statistiques de visionnage — heures totales,
top genres, top titres, "il y a 1 an", top annuel.
*/
export function StatsPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [topGenres, setTopGenres] = useState<[string, number][]>([]);
  const [topTitles, setTopTitles] = useState<TitleSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [yearAgoSessions, setYearAgoSessions] = useState<WatchSession[]>([]);
  const [yearTop, setYearTop] = useState<TitleSummary[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    titleApi.watchStats().then(setStats).catch(() => {});
    titleApi.topGenres(6).then(setTopGenres).catch(() => {});
    titleApi.topTitles(12).then(setTopTitles).catch(() => {});
    categoryApi.list().then(setCategories).catch(() => {});
    // "Il y a 1 an" : sessions de la même période l'an dernier
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    const oneYearAgoEnd = new Date(oneYearAgo);
    oneYearAgoEnd.setMonth(oneYearAgoEnd.getMonth() + 1);
    titleApi
      .watchSessions(oneYearAgo.toISOString(), oneYearAgoEnd.toISOString())
      .then(setYearAgoSessions)
      .catch(() => {});
    // Top annuel : titres les plus regardés cette année
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
    titleApi
      .watchSessions(yearStart.toISOString(), yearEnd.toISOString())
      .then((sessions) => {
        const titleCounts = new Map<number, number>();
        for (const session of sessions) {
          titleCounts.set(session.titleId, (titleCounts.get(session.titleId) ?? 0) + 1);
        }
        const sortedIds = Array.from(titleCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([id]) => id);
        return Promise.all(sortedIds.map((id) => titleApi.getDetails(id)));
      })
      .then((details) => {
        const summaries: TitleSummary[] = details.map((d) => ({
          id: d.id,
          category_id: d.category_id,
          kind: d.kind,
          name: d.name,
          year: d.year,
          poster: d.poster,
        }));
        setYearTop(summaries);
      })
      .catch(() => {});
    // resetKey (0.3.0) : le bouton « Réinitialiser » relance tous les
    // chargements après avoir effacé l'historique.
  }, [resetKey]);

  /** Bouton reset (0.3.0) : efface watch_history du profil puis
  recharge tous les compteurs. Confirmation obligatoire. */
  const handleReset = async () => {
    if (
      !window.confirm(
        "Remettre les compteurs Time Capsule à zéro ?\nL'historique de visionnage de ce profil sera définitivement effacé."
      )
    )
      return;
    setResetting(true);
    try {
      await invoke("reset_watch_stats");
      setResetKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  const openTitle = (title: TitleSummary) => {
    const category = categories.find((c) => c.id === title.category_id);
    if (category) navigate(`/category/${category.key}/title/${title.id}`);
  };

  return (
    <div>
      <PageHeader
        title="Time Capsule"
        description="Vos statistiques de visionnage : heures regardées, genres préférés, titres les plus vus."
        actions={
          <Button variant="ghost" onClick={() => void handleReset()} disabled={resetting}>
            <Trash2 size={14} /> {resetting ? "Réinitialisation…" : "Réinitialiser"}
          </Button>
        }
      />
      {stats === null ? (
        <p>Chargement…</p>
      ) : (
        <>
          <div className="avm-stats-grid">
            <div className="avm-stats-card">
              <h3>Heures regardées</h3>
              <p className="avm-stats-value">{stats.totalHours.toFixed(1)} h</p>
            </div>
            <div className="avm-stats-card">
              <h3>Sessions</h3>
              <p className="avm-stats-value">{stats.sessionCount}</p>
            </div>
            <div className="avm-stats-card">
              <h3>Titres uniques</h3>
              <p className="avm-stats-value">{stats.uniqueTitles}</p>
            </div>
            <div className="avm-stats-card">
              <h3>Genres explorés</h3>
              <p className="avm-stats-value">{stats.uniqueGenres}</p>
            </div>
          </div>
          {topGenres.length > 0 && (
            <section className="avm-stats-section">
              <h2>Top genres</h2>
              <div className="avm-stats-genres">
                {topGenres.map(([genre, count]) => (
                  <div key={genre} className="avm-stats-genre">
                    <span>{genre}</span>
                    <span className="avm-stats-genre-count">{count} session(s)</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {topTitles.length > 0 && (
            <section className="avm-stats-section">
              <h2>Titres les plus regardés</h2>
              <div className="avm-category-grid avm-category-grid--posters">
                {topTitles.map((title) => (
                  <button key={title.id} className="avm-explore-card" onClick={() => openTitle(title)}>
                    {assetUrl(title.poster) ? (
                      <img src={assetUrl(title.poster)} alt="" />
                    ) : (
                      <div className="avm-card__placeholder" aria-hidden="true" />
                    )}
                    <span className="avm-explore-card__name">{title.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {yearAgoSessions.length > 0 && (
            <section className="avm-stats-section">
              <h2>Il y a 1 an</h2>
              <p className="avm-settings-muted">
                Vous regardiez {yearAgoSessions.length} session(s) à cette période l'an dernier.
              </p>
            </section>
          )}
          {yearTop.length > 0 && (
            <section className="avm-stats-section">
              <h2>Top 10 de l'année</h2>
              <div className="avm-category-grid avm-category-grid--posters">
                {yearTop.map((title) => (
                  <button key={title.id} className="avm-explore-card" onClick={() => openTitle(title)}>
                    {assetUrl(title.poster) ? (
                      <img src={assetUrl(title.poster)} alt="" />
                    ) : (
                      <div className="avm-card__placeholder" aria-hidden="true" />
                    )}
                    <span className="avm-explore-card__name">{title.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {stats.sessionCount === 0 && (
            <EmptyState
              icon={<BarChart3 size={32} />}
              title="Aucune statistique pour l'instant"
              description="Regardez quelques films ou séries pour voir vos statistiques ici."
            />
          )}
        </>
      )}
    </div>
  );
}