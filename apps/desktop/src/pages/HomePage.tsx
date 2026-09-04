import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Info, Play } from "lucide-react";
import { Button, PageHeader } from "@aethervault/ui-kit";
import type { Category, TitleDetails, TitleSummary } from "@aethervault/shared-types";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { categoryApi } from "../features/category/api";
import { titleApi, type ContinueWatchingItem } from "../features/title/api";
import { libraryApi } from "../features/library/api";
import { usePlayer } from "../player/PlayerContext";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/** 0.4.0 : détection tolérante de la catégorie Animés. */
function isAnimeCategory(c: Category): boolean {
  return (
    c.key === "animes" ||
    c.key === "anime" ||
    c.name.toLowerCase().includes("anim")
  );
}

/**
 * Accueil v2 (Étape 7, 3 niveaux validés) :
 * - héro « à la une » : backdrop TMDB assombri + nom/méta/synopsis +
 *   boutons Lecture (films) / Plus d'infos, change à chaque lancement ;
 * - tuiles catégories en 16:9, nom en overlay, hover élévation ;
 * - rangées horizontales « style Netflix » : Ajouts récents + une rangée
 *   par catégorie publique, affiches verticales, survol nom/année.
 *
 * 0.4.0 : tuile AetherFy (badge « Alpha », bannière personnalisée en
 * attendant la bannière universelle) insérée entre Animé et Privé ;
 * option pour masquer la catégorie Privé (persistée, réversible).
 *
 * 0.4.1 (audit UX) : erreurs de chargement affichées à l'utilisateur
 * avec bouton « Réessayer » (plus de page vide silencieuse).
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
  // 0.4.0 : visibilité de la catégorie Privé sur l'accueil.
  const [hidePrivate, setHidePrivate] = useState<boolean>(() => {
    try {
      return localStorage.getItem("avm-home-hide-private") === "1";
    } catch {
      return false;
    }
  });
  // 0.4.1 (audit UX) : erreurs de chargement visibles + rechargement.
  const [loadingErrors, setLoadingErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const applyHidePrivate = (hidden: boolean) => {
    setHidePrivate(hidden);
    try {
      localStorage.setItem("avm-home-hide-private", hidden ? "1" : "0");
    } catch {
      // stockage indisponible : non bloquant
    }
  };

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

  // 0.4.1 : chaque échec de chargement est signalé à l'utilisateur.
  useEffect(() => {
    setLoadingErrors([]);
    setRows({});
    const pushError = (msg: string) =>
      setLoadingErrors((prev) => [...prev, msg]);

    categoryApi
      .list()
      .then(setCategories)
      .catch((err) => {
        pushError(`Catégories indisponibles : ${String(err)}`);
        setCategories([]);
      });

    titleApi
      .hero()
      .then(setHero)
      .catch((err) => {
        console.warn("[home] héro échoué :", err);
        setHero(null);
      });

    titleApi
      .recent()
      .then(setRecent)
      .catch((err) => {
        pushError(`Ajouts récents indisponibles : ${String(err)}`);
        setRecent([]);
      });

    titleApi
      .continueWatching()
      .then(setContinueItems)
      .catch((err) => {
        console.warn("[home] continuer à regarder échoué :", err);
        setContinueItems([]);
      });
  }, [reloadKey]);

  useEffect(() => {
    if (!categories) return;
    for (const category of categories) {
      if (category.key === "private") continue;
      titleApi
        .listByCategory(category.id)
        .then((list) => setRows((prev) => ({ ...prev, [category.id]: list })))
        .catch((err) => {
          console.warn(`[home] catégorie ${category.name} échouée :`, err);
        });
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

  /** 0.4.0 : tuile AetherFy — bannière horizontale personnalisée
   * (dégradé) en attendant la bannière universelle ; badge « Alpha ».
   * Pour passer à la bannière universelle : remplacer le <div> dégradé
   * par <img src={assetUrl(...)} /> comme les autres tuiles. */
  const aetherfyTile = (
    <button
      key="aetherfy"
      type="button"
      className="avm-home-tile"
      onClick={() => navigate("/vaulttube")}
      style={{ position: "relative" }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(120deg, #140b2e 0%, #3b1d7a 50%, #7c5cff 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: 1,
            color: "#fff",
            textShadow: "0 2px 14px rgba(0,0,0,.5)",
          }}
        >
          AetherFy
        </span>
      </div>
      <span className="avm-home-tile__overlay">
        <span
          className="avm-home-tile__name"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          AetherFy
          {/* 0.4.0 : sigle Alpha */}
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              padding: "2px 6px",
              borderRadius: 999,
              background: "rgba(255,255,255,.16)",
              border: "1px solid rgba(255,255,255,.35)",
              color: "#fff",
            }}
          >
            Alpha
          </span>
        </span>
        <span className="avm-home-tile__count">Streaming en ligne</span>
      </span>
    </button>
  );

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

      {/* 0.4.1 (audit UX) : erreurs de chargement visibles + Réessayer. */}
      {loadingErrors.length > 0 && (
        <div style={{ padding: "8px 24px 0" }}>
          {loadingErrors.map((err, i) => (
            <div
              key={i}
              role="alert"
              style={{
                padding: "10px 14px",
                margin: "8px 0",
                background: "rgba(255, 59, 48, 0.1)",
                border: "1px solid rgba(255, 59, 48, 0.3)",
                borderRadius: 8,
                fontSize: 13,
                color: "#ff6b6b",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>⚠️ {err}</span>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                style={{
                  background: "rgba(255, 59, 48, 0.2)",
                  border: "1px solid rgba(255, 59, 48, 0.4)",
                  color: "#ff6b6b",
                  cursor: "pointer",
                  padding: "5px 10px",
                  borderRadius: 4,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                Réessayer
              </button>
            </div>
          ))}
        </div>
      )}

      {categories !== null && (
        <>
          <div className="avm-home-tiles">
            {categories.flatMap((category) => {
              const out: ReactNode[] = [];
              if (category.key === "private") {
                // 0.4.0 : Privé masquable depuis l'accueil.
                if (!hidePrivate) {
                  out.push(
                    <button
                      key={category.id}
                      className="avm-home-tile"
                      onClick={() => navigate("/private")}
                      style={{ position: "relative" }}
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
                      {/* 0.4.0 : bouton masquer Privé (coin haut droit) */}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Masquer la catégorie Privé de l'accueil"
                        onClick={(e) => {
                          e.stopPropagation();
                          applyHidePrivate(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            applyHidePrivate(true);
                          }
                        }}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          zIndex: 2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          background: "rgba(0,0,0,.55)",
                          color: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <EyeOff size={13} />
                      </span>
                    </button>
                  );
                }
                return out;
              }
              out.push(
                <button
                  key={category.id}
                  className="avm-home-tile"
                  onClick={() => navigate(`/category/${category.key}`)}
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
              );
              // 0.4.0 : AetherFy juste après Animé (donc entre Animé et Privé).
              if (isAnimeCategory(category)) out.push(aetherfyTile);
              return out;
            })}
            {/* Repli : si aucune catégorie Animé, AetherFy en fin de grille. */}
            {!categories.some(isAnimeCategory) && aetherfyTile}
          </div>
          {/* 0.4.0 : contrôle de restauration quand Privé est masqué. */}
          {hidePrivate && (
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 8px 0" }}>
              <button
                type="button"
                onClick={() => applyHidePrivate(false)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "var(--color-text-muted, #9a9aa3)",
                  background: "transparent",
                  border: "1px dashed var(--color-border, #2c2c33)",
                  borderRadius: 8,
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                <Eye size={12} />
                Catégorie Privé masquée — afficher
              </button>
            </div>
          )}
        </>
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