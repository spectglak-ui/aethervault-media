import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Info, Play } from "lucide-react";
import { Button, PageHeader } from "@aethervault/ui-kit";
import type { Category, TitleDetails, TitleSummary } from "@aethervault/shared-types";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { categoryApi } from "../features/category/api";
import { titleApi, type ContinueWatchingItem } from "../features/title/api";
import { libraryApi } from "../features/library/api";
import { usePlayer } from "../player/PlayerContext";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/**
 * Accueil v2 (Étape 7, 3 niveaux validés) :
 * - héro « à la une » : backdrop TMDB assombri + nom/méta/synopsis +
 *   boutons Lecture (films) / Plus d'infos, change à chaque lancement ;
 * - tuiles catégories en 16:9 (plus de logos coupés), nom en overlay,
 *   hover élévation ;
 * - rangées horizontales « style Netflix » : Ajouts récents + une rangée
 *   par catégorie publique, affiches verticales, survol nom/année.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { play } = usePlayer();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [rows, setRows] = useState<Record<number, TitleSummary[]>>({});
  const [recent, setRecent] = useState<TitleSummary[] | null>(null);
  const [continueItems, setContinueItems] = useState<ContinueWatchingItem[] | null>(null);
  const [hero, setHero] = useState<TitleDetails | null>(null);
  const [starting, setStarting] = useState(false);
    const [homeBackdrop, setHomeBackdrop] = useState<string | null>(null);
  useEffect(() => {
    const load = () => {
      invoke<string | null>("get_home_backdrop")
        .then((path) => setHomeBackdrop(path ? convertFileSrc(path) : null))
        .catch(() => {});
    };
    load();
    window.addEventListener("avm-home-backdrop-changed", load);
    return () => window.removeEventListener("avm-home-backdrop-changed", load);
  }, []);

  useEffect(() => {
    categoryApi.list().then(setCategories).catch(() => setCategories([]));
    titleApi.hero().then(setHero).catch(() => setHero(null));
    titleApi.recent().then(setRecent).catch(() => setRecent([]));
	titleApi.continueWatching().then(setContinueItems).catch(() => setContinueItems([]));
	titleApi.continueWatching().then(setContinueItems).catch(() => setContinueItems([]));
  }, []);

  useEffect(() => {
    if (!categories) return;
    for (const category of categories) {
      if (category.key === "private") continue;
      titleApi
        .listByCategory(category.id)
        .then((list) => setRows((prev) => ({ ...prev, [category.id]: list })))
        .catch(() => {});
    }
  }, [categories]);

  const heroCategory =
    hero && categories ? categories.find((c) => c.id === hero.category_id) : undefined;

    /** Rangée « Continuer à regarder » : le clic relance la lecture, la
   * reprise de position est déjà gérée par le lecteur. */
  const handleContinuePlay = (item: ContinueWatchingItem) => {
    play({ id: item.mediaFileId, title: item.label, path: item.path, libraryId: item.libraryId });
  };

  const handleHeroPlay = async () => {
    if (!hero || hero.media_file_id === null) return;
    setStarting(true);
    try {
      const file = await libraryApi.getMediaFile(hero.media_file_id);
      play({ id: file.id, title: hero.name, path: file.path, libraryId: file.library_id });
    } finally {
      setStarting(false);
    }
  };

  const openTitle = (title: TitleSummary) => {
    const category = categories?.find((c) => c.id === title.category_id);
    if (category) navigate(`/category/${category.key}/title/${title.id}`);
  };

    return (
    <div
      style={
        homeBackdrop
          ? {
              backgroundImage: `linear-gradient(rgba(12, 12, 16, 0.72), rgba(12, 12, 16, 0.9)), url(${homeBackdrop})`,
              backgroundAttachment: "fixed",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      {hero && assetUrl(hero.banner) ? (
        <section className="avm-home-hero">
          <img src={assetUrl(hero.banner)} alt="" />
          <div className="avm-home-hero__overlay" />
          <div className="avm-home-hero__content">
            <h1>{hero.name}</h1>
            <p className="avm-home-hero__meta">
              {[
                hero.year,
                hero.rating ? `★ ${hero.rating.toFixed(1)}` : null,
                heroCategory?.name ?? null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {hero.description && (
              <p className="avm-home-hero__synopsis">{hero.description}</p>
            )}
            <div className="avm-home-hero__actions">
              {hero.kind === "movie" && hero.media_file_id !== null && (
                <Button
                  variant="primary"
                  onClick={() => void handleHeroPlay()}
                  disabled={starting}
                >
                  <Play size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                  Lecture
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  if (heroCategory)
                    navigate(`/category/${heroCategory.key}/title/${hero.id}`);
                }}
              >
                <Info size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                Plus d'infos
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <PageHeader
          title="Accueil"
          description="Toute votre médiathèque, organisée par catégorie."
        />
      )}

      {categories !== null && (
        <div className="avm-home-tiles">
          {categories.map((category) => (
            <button
              key={category.id}
              className="avm-home-tile"
              onClick={() =>
                navigate(category.key === "private" ? "/private" : `/category/${category.key}`)
              }
            >
              {assetUrl(category.banner) ? (
                <img src={assetUrl(category.banner)} alt="" />
              ) : (
                <div className="avm-card__placeholder" aria-hidden="true" />
              )}
              <span className="avm-home-tile__overlay">
                <span className="avm-home-tile__name">{category.name}</span>
                <span className="avm-home-tile__count">
                  {category.title_count === null ? "🔒" : `${category.title_count} titre(s)`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {continueItems !== null && continueItems.length > 0 && (
        <PosterRow title="Continuer à regarder">
          {continueItems.map((item) => {
            const percent = Math.min(
              100,
              Math.max(1, Math.round((item.positionSeconds / item.durationSeconds) * 100))
            );
            return (
              <button
                key={`continue-${item.mediaFileId}`}
                className="avm-home-poster"
                onClick={() => handleContinuePlay(item)}
              >
                {assetUrl(item.poster) ? (
                  <img src={assetUrl(item.poster)} alt="" loading="lazy" />
                ) : (
                  <div className="avm-card__placeholder" aria-hidden="true" />
                )}
                <span className="avm-home-poster__overlay avm-home-poster__overlay--visible">
                  <span className="avm-home-poster__name">{item.label}</span>
                  <span className="avm-home-poster__meta">{percent}% vu</span>
                </span>
                <span className="avm-home-poster__progress" aria-hidden="true">
                  <span style={{ width: `${percent}%` }} />
                </span>
              </button>
            );
          })}
        </PosterRow>
      )}

      {recent !== null && recent.length > 0 && (
        <PosterRow title="Ajouts récents">
          {recent.map((title) => (
            <PosterCard key={`recent-${title.id}`} title={title} onOpen={() => openTitle(title)} />
          ))}
        </PosterRow>
      )}

      {categories !== null &&
        categories
          .filter((c) => c.key !== "private" && (rows[c.id]?.length ?? 0) > 0)
          .map((category) => (
            <PosterRow key={category.id} title={category.name}>
              {(rows[category.id] ?? []).map((title) => (
                <PosterCard
                  key={`${category.key}-${title.id}`}
                  title={title}
                  onOpen={() => openTitle(title)}
                />
              ))}
            </PosterRow>
          ))}
    </div>
  );
}

function PosterRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="avm-home-row">
      <h2>{title}</h2>
      <div className="avm-home-row__scroll">{children}</div>
    </section>
  );
}

function PosterCard({ title, onOpen }: { title: TitleSummary; onOpen: () => void }) {
  return (
    <button className="avm-home-poster" onClick={onOpen}>
      {assetUrl(title.poster) ? (
        <img src={assetUrl(title.poster)} alt="" loading="lazy" />
      ) : (
        <div className="avm-card__placeholder" aria-hidden="true" />
      )}
      <span className="avm-home-poster__overlay">
        <span className="avm-home-poster__name">{title.name}</span>
        {title.year !== null && <span className="avm-home-poster__meta">{title.year}</span>}
      </span>
    </button>
  );
}