import type { TitleSearchQuery } from "@aethervault/shared-types";

/** Types de média proposés dans la recherche : ce sont les catégories publiques. */
export const MEDIA_TYPES: { key: string; label: string }[] = [
  { key: "movies", label: "Film" },
  { key: "series", label: "Série" },
  { key: "anime", label: "Anime" },
  { key: "documentaries", label: "Documentaire" },
];

export function emptyQuery(q = ""): TitleSearchQuery {
  return {
    q,
    category_keys: [],
    kinds: [],
    year_from: null,
    year_to: null,
    genres: [],
    actor: null,
    director: null,
    resolutions: [],
    codecs: [],
    audio_langs: [],
    sagas: [],
  };
}

/** Nombre de filtres actifs, hors texte libre. */
export function countActiveFilters(query: TitleSearchQuery): number {
  let n = 0;
  if (query.category_keys.length) n += 1;
  if (query.kinds.length) n += 1;
  if (query.year_from != null || query.year_to != null) n += 1;
  if (query.genres.length) n += 1;
  if (query.actor?.trim()) n += 1;
  if (query.director?.trim()) n += 1;
  if (query.sagas.length) n += 1;
  if (query.resolutions.length) n += 1;
  if (query.codecs.length) n += 1;
  if (query.audio_langs.length) n += 1;
  return n;
}

/** La requête fait-elle quelque chose (texte ou au moins un filtre) ? */
export function isQueryActive(query: TitleSearchQuery): boolean {
  return (query.q ?? "").trim().length > 0 || countActiveFilters(query) > 0;
}

const LIST_KEYS = [
  ["type", "category_keys"],
  ["kind", "kinds"],
  ["genre", "genres"],
  ["saga", "sagas"],
  ["res", "resolutions"],
  ["codec", "codecs"],
  ["lang", "audio_langs"],
] as const;

/** Requête → paramètres d'URL (partageables, rechargeables, historisés). */
export function queryToParams(query: TitleSearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  const q = (query.q ?? "").trim();
  if (q) params.set("q", q);
  for (const [param, field] of LIST_KEYS) {
    for (const value of query[field]) params.append(param, value);
  }
  if (query.year_from != null) params.set("from", String(query.year_from));
  if (query.year_to != null) params.set("to", String(query.year_to));
  if (query.actor?.trim()) params.set("actor", query.actor.trim());
  if (query.director?.trim()) params.set("director", query.director.trim());
  return params;
}

function numberParam(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function paramsToQuery(params: URLSearchParams): TitleSearchQuery {
  const query = emptyQuery(params.get("q") ?? "");
  for (const [param, field] of LIST_KEYS) {
    query[field] = params.getAll(param).filter((v) => v.length > 0);
  }
  query.year_from = numberParam(params.get("from"));
  query.year_to = numberParam(params.get("to"));
  query.actor = params.get("actor");
  query.director = params.get("director");
  return query;
}

/** Ajoute ou retire une valeur d'une liste (case à cocher). */
export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
