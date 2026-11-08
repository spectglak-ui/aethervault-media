import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  Clapperboard,
  Film,
  MonitorPlay,
  Star,
  Tag,
  Users,
} from "lucide-react";
import { Button, EmptyState } from "@aethervault/ui-kit";
import type {
  Category,
  SagaStatus,
  SmartCollection,
  SmartCollectionKind,
  TitleSummary,
} from "@aethervault/shared-types";
import { titleApi } from "../title/api";
import { assetUrl } from "../../lib/assetUrl";
import "./smart.css";

const KINDS: { kind: SmartCollectionKind; label: string; icon: typeof Film }[] = [
  { kind: "saga", label: "Sagas", icon: Film },
  { kind: "genre", label: "Genres", icon: Tag },
  { kind: "director", label: "Réalisateurs", icon: Clapperboard },
  { kind: "actor", label: "Acteurs", icon: Users },
  { kind: "studio", label: "Studios", icon: Building2 },
  { kind: "decade", label: "Décennies", icon: CalendarDays },
  { kind: "quality", label: "Qualité", icon: MonitorPlay },
  { kind: "rating", label: "Mieux notés", icon: Star },
];

function displayName(collection: SmartCollection): string {
  return collection.kind === "quality" ? `Qualité ${collection.name}` : collection.name;
}

function Mosaic({ posters }: { posters: string[] }) {
  const shown = posters.slice(0, 4);
  const urls = shown.map((path) => assetUrl(path)).filter((url): url is string => Boolean(url));
  if (urls.length === 0) {
    return (
      <div className="avm-smart-card__mosaic avm-smart-card__mosaic--1">
        <div className="avm-smart-card__placeholder" aria-hidden="true" />
      </div>
    );
  }
  const layout = urls.length >= 4 ? "4" : urls.length >= 2 ? "2" : "1";
  return (
    <div className={`avm-smart-card__mosaic avm-smart-card__mosaic--${layout}`} aria-hidden="true">
      {urls.slice(0, layout === "4" ? 4 : layout === "2" ? 2 : 1).map((url) => (
        <img key={url} src={url} alt="" loading="lazy" />
      ))}
    </div>
  );
}

/**
 * Collections intelligentes : calculées automatiquement à partir du
 * catalogue (aucune saisie) — sagas (TMDB), genres, réalisateurs, acteurs,
 * studios, décennies, qualité d'image, mieux notés. Elles se mettent à jour
 * seules à chaque scan ; les sagas des films déjà présents sont détectées en
 * tâche de fond au premier affichage (si TMDB est configuré).
 */
export function SmartCollectionsView({ categories }: { categories: Category[] }) {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<SmartCollection[] | null>(null);
  const [kind, setKind] = useState<SmartCollectionKind | null>(null);
  const [opened, setOpened] = useState<SmartCollection | null>(null);
  const [titles, setTitles] = useState<TitleSummary[] | null>(null);
  const [saga, setSaga] = useState<SagaStatus | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const detectionStarted = useRef(false);

  const reload = useCallback(() => {
    titleApi.smartCollections().then(setCollections).catch(() => setCollections([]));
    titleApi.sagaStatus().then(setSaga).catch(() => setSaga(null));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Détection rétroactive des sagas : une seule fois par ouverture de page.
  useEffect(() => {
    if (!saga || detectionStarted.current) return;
    if (saga.unchecked > 0 && saga.tmdb_configured && !saga.running) {
      detectionStarted.current = true;
      setProgress({ processed: 0, total: saga.unchecked });
      titleApi.detectSagas().catch(() => setProgress(null));
    } else if (saga.running) {
      detectionStarted.current = true;
      setProgress({ processed: 0, total: saga.unchecked });
    }
  }, [saga]);

  useEffect(() => {
    const unlistenProgress = listen<{ processed: number; total: number }>(
      "collections:sagas-progress",
      (event) => setProgress(event.payload)
    );
    const unlistenDone = listen("collections:sagas-updated", () => {
      setProgress(null);
      reload();
    });
    // Un nouveau scan ou un nouvel appariement peut créer des collections.
    const unlistenScan = listen("library:scan-complete", () => reload());
    const unlistenMatch = listen("library:metadata-matched", () => reload());
    return () => {
      for (const unlisten of [unlistenProgress, unlistenDone, unlistenScan, unlistenMatch]) {
        unlisten.then((stop) => stop());
      }
    };
  }, [reload]);

  // Onglet par défaut : le premier type qui contient quelque chose.
  useEffect(() => {
    if (!collections || kind !== null) return;
    const first = KINDS.find((k) => collections.some((c) => c.kind === k.kind));
    setKind(first ? first.kind : "saga");
  }, [collections, kind]);

  useEffect(() => {
    if (!opened) {
      setTitles(null);
      return;
    }
    setTitles(null);
    titleApi
      .smartCollectionTitles(opened.kind, opened.key)
      .then(setTitles)
      .catch(() => setTitles([]));
  }, [opened]);

  if (collections === null) return <p>Chargement…</p>;

  const categoryKeyOf = (title: TitleSummary) =>
    categories.find((category) => category.id === title.category_id)?.key;

  if (opened) {
    return (
      <div>
        <div className="avm-smart-detail__head">
          <Button variant="ghost" onClick={() => setOpened(null)}>
            <ChevronLeft size={16} style={{ verticalAlign: "text-bottom" }} /> Collections
          </Button>
          <h2 className="avm-smart-detail__title">{displayName(opened)}</h2>
          <span className="avm-settings-muted">
            {opened.count} titre{opened.count > 1 ? "s" : ""}
          </span>
        </div>
        {titles === null ? (
          <p>Chargement…</p>
        ) : titles.length === 0 ? (
          <EmptyState title="Collection vide" description="Aucun titre ne correspond pour l'instant." />
        ) : (
          <div className="avm-category-grid avm-category-grid--posters">
            {titles.map((title) => {
              const categoryKey = categoryKeyOf(title);
              return (
                <button
                  key={title.id}
                  className="avm-explore-card"
                  disabled={!categoryKey}
                  onClick={() => categoryKey && navigate(`/category/${categoryKey}/title/${title.id}`)}
                >
                  {assetUrl(title.poster) ? (
                    <img src={assetUrl(title.poster)} alt="" />
                  ) : (
                    <div className="avm-card__placeholder" aria-hidden="true" />
                  )}
                  <span className="avm-explore-card__name">{title.name}</span>
                  <span className="avm-card__subtitle">{title.year ? String(title.year) : ""}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const available = KINDS.filter(
    (k) => collections.some((c) => c.kind === k.kind) || (k.kind === "saga" && progress !== null)
  );
  const current = collections.filter((c) => c.kind === kind);
  const sagaHint =
    kind === "saga" && current.length === 0
      ? saga && !saga.tmdb_configured
        ? "Les sagas viennent de TMDB : configurez votre clé TMDB dans les Paramètres pour les détecter automatiquement."
        : progress === null
          ? "Aucune saga détectée pour l'instant : il faut au moins deux films d'une même saga dans votre catalogue."
          : null
      : null;

  return (
    <div>
      {progress && (
        <p className="avm-smart-banner" role="status">
          Détection des sagas en cours… {progress.processed}/{progress.total}
        </p>
      )}
      {available.length === 0 ? (
        <EmptyState
          title="Pas encore de collections automatiques"
          description="Elles apparaissent toutes seules dès que votre catalogue contient assez de titres liés (même genre, même réalisateur, même saga…). Lancez un scan de vos bibliothèques pour commencer."
        />
      ) : (
        <>
          <div className="avm-smart-tabs" role="tablist" aria-label="Type de collection">
            {available.map(({ kind: k, label, icon: Icon }) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                className={kind === k ? "avm-chip avm-chip--active" : "avm-chip"}
                onClick={() => setKind(k)}
              >
                <Icon size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                {label}
                <span className="avm-smart-tabs__count">
                  {collections.filter((c) => c.kind === k).length}
                </span>
              </button>
            ))}
          </div>
          {sagaHint && <p className="avm-settings-muted">{sagaHint}</p>}
          <div className="avm-smart-grid">
            {current.map((collection) => (
              <button
                key={`${collection.kind}-${collection.key}`}
                className="avm-smart-card"
                onClick={() => setOpened(collection)}
              >
                <Mosaic posters={collection.posters} />
                <span className="avm-smart-card__body">
                  <span className="avm-smart-card__name">{displayName(collection)}</span>
                  <span className="avm-smart-card__count">
                    {collection.count} titre{collection.count > 1 ? "s" : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
