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
import { useAnimatedBackdropActive } from "../hooks/useAnimatedBackdropActive";
import "./pages.css";
import "./home/home-modern.css";
import { HomeStats } from "./home/HomeStats";
import { HomeUniverses } from "./home/HomeUniverses";
import { HomeWelcome } from "./home/HomeWelcome";

/**
 * Accueil v2 : héro « à la une », tuiles catégories 16:9, rangées
 * horizontales style Netflix.
 * 0.4.0 : tuile AetherFy (badge Alpha) entre Animé et Privé.
 * 0.4.1 : masquage de Privé piloté depuis les Paramètres (plus aucun
 * contrôle sur l'accueil).
 * 0.5.4 : le fond personnalisé devient une couche FIXE plein-fenêtre
 * (derrière la sidebar, la barre du haut et tout le contenu) pour que
 * le thème Transparent laisse voir l'image à travers le verre.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { play } = usePlayer();
  // FONCTIONNALITÉ : masque le fond statique de CETTE page quand le fond
  // animé global est actif (voir le hook pour le pourquoi — empilement
  // z-index entre arbres séparés jugé pas assez fiable).
  const animatedBackdropActive = useAnimatedBackdropActive();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [rows, setRows] = useState<Record<number, TitleSummary[]>>({});
  const [recent, setRecent] = useState<TitleSummary[] | null>(null);
  const [continueItems, setContinueItems] = useState<ContinueWatchingItem[] | null>(null);
  const [hero, setHero] = useState<TitleDetails | null>(null);
  const [starting, setStarting] = useState(false);
  const [homeBackdrop, setHomeBackdrop] = useState<string | null>(null);
  const [hidePrivate, setHidePrivate] = useState<boolean>(() => {
    try {
      return localStorage.getItem("avm-home-hide-private") === "1";
    } catch {
      return false;
    }
  });

  // 0.4.1 : l'option vit dans les Paramètres — écoute du changement
  // pour mettre à jour l'accueil sans rechargement.
  useEffect(() => {
    const sync = () => {
      try {
        setHidePrivate(localStorage.getItem("avm-home-hide-private") === "1");
      } catch {
        // best-effort
      }
    };
    window.addEventListener("avm-home-hide-private-changed", sync);
    return () => window.removeEventListener("avm-home-hide-private-changed", sync);
  }, []);

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
    <div>
      {/* 0.5.4 — fond personnalisé en couche FIXE plein-fenêtre : couvre
          TOUTE la fenêtre (y compris derrière sidebar/barre du haut) et
          passe DERRIÈRE le contenu (z-index 0 vs 1).
          FONCTIONNALITÉ : masqué quand le fond animé est actif, pour
          qu'il ne reste jamais visible par-dessus. */}
      {homeBackdrop && !animatedBackdropActive && (
        <div
          className="avm-page-backdrop"
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            backgroundImage: `linear-gradient(rgba(12, 12, 16, 0.72), rgba(12, 12, 16, 0.9)), url(${homeBackdrop})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}
      {/* Contenu remonté au-dessus de la couche fixe.
          FONCTIONNALITÉ : zIndex 1 → 3, pour laisser le fond animé global
          (z-index 1 quand actif, voir styles/global.css) passer par-dessus
          le fond statique de CETTE page (ci-dessus, resté à 0) sans jamais
          couvrir ce contenu. */}
      <div className="avm-hx" style={{ position: "relative", zIndex: 3 }}>
        <HomeWelcome />
        {hero && assetUrl(hero.banner) ? (
          <section className="avm-home-hero">
            <img src={assetUrl(hero.banner)} alt="" />
            <div className="avm-home-hero__overlay" />
            <div className="avm-home-hero__content">
              <span className="avm-hx-pill">À la une</span>
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
          <HomeUniverses categories={categories} hidePrivate={hidePrivate} />
        )}
        {continueItems !== null && continueItems.length > 0 && (
          <PosterRow title="Continuer à regarder" count={continueItems.length}>
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
          <PosterRow title="Ajouts récents" count={recent.length} live>
            {recent.map((title) => (
              <PosterCard key={`recent-${title.id}`} title={title} onOpen={() => openTitle(title)} />
            ))}
          </PosterRow>
        )}
        {categories !== null && <HomeStats categories={categories} />}
        {categories !== null &&
          categories
            .filter((c) => c.key !== "private" && (rows[c.id]?.length ?? 0) > 0)
            .map((category) => (
              <PosterRow key={category.id} title={category.name} count={rows[category.id]?.length}>
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
    </div>
  );
}

function PosterRow({
  title,
  count,
  live,
  children,
}: {
  title: string;
  count?: number;
  /** Pastille « Nouveau » animée (Ajouts récents). */
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="avm-home-row">
      <h2>
        {title}
        {count !== undefined && <span className="avm-hx-count">{count}</span>}
        {live && <span className="avm-hx-live">Nouveau</span>}
      </h2>
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