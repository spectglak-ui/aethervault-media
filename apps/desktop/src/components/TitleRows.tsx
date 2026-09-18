import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Category, TitleSummary } from "@aethervault/shared-types";
import { categoryApi } from "../features/category/api";
import { personApi, titleApi, type PersonCredit } from "../features/title/api";
import { assetUrl } from "../lib/assetUrl";

/** 0.6.0 : rangée « Distribution » — bannières verticales des acteurs
 * (photo TMDB locale), clic → page Personne. */
export function CastRow({ titleId }: { titleId: number }) {
  const navigate = useNavigate();
  const [cast, setCast] = useState<PersonCredit[]>([]);
  useEffect(() => {
    let alive = true;
    personApi
      .credits(titleId)
      .then((c) => alive && setCast(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [titleId]);
  if (cast.length === 0) return null;
  return (
    <section className="avm-title-page__similar">
      <h2>Distribution</h2>
      <div className="avm-cast-row">
        {cast.map((p) => (
          <button
            key={p.person_id}
            className="avm-cast-card"
            title={p.character ?? p.name}
            onClick={() => navigate(`/person/${p.person_id}`)}
          >
            {p.profile_path ? (
              <img src={assetUrl(p.profile_path)} alt="" />
            ) : (
              <div className="avm-cast-card__fallback" aria-hidden="true">
                {p.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="avm-cast-card__name">{p.name}</span>
            {p.character && <span className="avm-card__subtitle">{p.character}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

/** 0.6.0 : rangée « Du même genre » — suggestions de titres sous forme
 * de bannières verticales, en bas des pages Film / Saison / Anime.
 * Source principale : `list_similar_titles` (genres/acteurs/studios
 * communs). Si cet appel échoue ou renvoie vide (bibliothèque trop
 * petite, commande absente…), REPLI automatique sur les autres titres
 * de la même catégorie — la rangée s'affiche donc toujours, et un
 * `console.warn` nous indique quel appel a échoué. */
export function GenreRow({ titleId, categoryKey }: { titleId: number; categoryKey: string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<TitleSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    let alive = true;
    categoryApi
      .list()
      .then((c) => alive && setCategories(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let list: TitleSummary[] = [];
      try {
        list = (await titleApi.similar(titleId, 12)).filter((t) => t.id !== titleId);
      } catch (err) {
        console.warn("[GenreRow] list_similar_titles indisponible :", err);
      }
      if (list.length === 0) {
        // Repli : les autres titres de la même catégorie (Film / Série / Anime).
        try {
          const cats = await categoryApi.list();
          const cat = cats.find((c) => c.key === categoryKey);
          if (cat) {
            const all = await titleApi.listByCategory(cat.id);
            list = all.filter((t) => t.id !== titleId).slice(0, 12);
          }
        } catch (err) {
          console.warn("[GenreRow] repli même catégorie indisponible :", err);
        }
      }
      if (alive) setItems(list);
    })();
    return () => {
      alive = false;
    };
  }, [titleId, categoryKey]);

  if (items.length === 0) return null;
  const open = (t: TitleSummary) => {
    const cat = categories.find((c) => c.id === t.category_id);
    if (cat) navigate(`/category/${cat.key}/title/${t.id}`);
  };
  return (
    <section className="avm-title-page__similar">
      <h2>Du même genre</h2>
      <div className="avm-category-grid avm-category-grid--posters">
        {items.map((t) => (
          <button key={t.id} className="avm-explore-card" onClick={() => open(t)}>
            {assetUrl(t.poster) ? (
              <img src={assetUrl(t.poster)} alt="" />
            ) : (
              <div className="avm-card__placeholder" aria-hidden="true" />
            )}
            <span className="avm-explore-card__name">{t.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}