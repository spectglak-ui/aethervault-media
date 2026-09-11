import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { EmptyState, PageHeader } from "@aethervault/ui-kit";
import type { Category, TitleSummary } from "@aethervault/shared-types";
import { categoryApi } from "../features/category/api";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

/** 0.6.0 : fiche personne renvoyée par la commande `get_person`. */
interface PersonInfo {
  name: string;
  biography: string | null;
  profile_path: string | null;
}

/**
 * 0.6.0 — page Personne : photo de profil, biographie TMDB et rangée
 * des titres POSSÉDÉS dans lesquels la personne apparaît
 * (`list_person_titles` = intersection filmographie TMDB ∩ bibliothèque).
 */
export function PersonPage() {
  const { personId } = useParams<{ personId: string }>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<PersonInfo | null | undefined>(undefined);
  const [titles, setTitles] = useState<TitleSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const id = Number(personId);

  useEffect(() => {
    if (!personId || Number.isNaN(id)) return;
    let alive = true;
    invoke<PersonInfo>("get_person", { personId: id })
      .then((p) => {
        if (alive) setPerson(p);
      })
      .catch(() => {
        if (alive) setPerson(null);
      });
    invoke<TitleSummary[]>("list_person_titles", { personId: id })
      .then((t) => {
        if (alive) setTitles(t);
      })
      .catch(() => {
        if (alive) setTitles([]);
      });
    categoryApi
      .list()
      .then((c) => {
        if (alive) setCategories(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [personId, id]);

  if (person === undefined) return <p>Chargement…</p>;
  if (person === null) {
    return (
      <EmptyState
        title="Personne introuvable"
        description="Fiche TMDB indisponible (clé API absente, réseau coupé ou commande non enregistrée)."
      />
    );
  }

  const open = (t: TitleSummary) => {
    const cat = categories.find((c) => c.id === t.category_id);
    if (cat) navigate(`/category/${cat.key}/title/${t.id}`);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", margin: "8px 0 20px" }}>
        {person.profile_path ? (
          <img
            src={assetUrl(person.profile_path)}
            alt=""
            style={{ width: 140, height: 200, objectFit: "cover", borderRadius: 12 }}
          />
        ) : (
          <div
            className="avm-cast-card__fallback"
            style={{ width: 140, height: 200, fontSize: 56, borderRadius: 12 }}
            aria-hidden="true"
          >
            {person.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <PageHeader title={person.name} />
          {person.biography && (
            <p className="avm-title-page__description" style={{ maxWidth: 720 }}>
              {person.biography}
            </p>
          )}
        </div>
      </div>
      {titles.length === 0 ? (
        <EmptyState
          title="Aucun titre possédé"
          description="Cette personne apparaît dans des titres que vous ne possédez pas (ou pas encore scannés)."
        />
      ) : (
        <section className="avm-title-page__similar">
          <h2>Dans votre bibliothèque</h2>
          <div className="avm-category-grid avm-category-grid--posters">
            {titles.map((t) => (
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
      )}
    </div>
  );
}