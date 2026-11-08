-- Migration 0027 — Sagas (Collections intelligentes).
--
-- TMDB expose pour chaque film le champ `belongs_to_collection` (la saga à
-- laquelle il appartient, ex. « Saga Harry Potter »). On en garde
-- l'identifiant et le nom directement sur le Titre : pas de nouvelle table,
-- donc aucune jointure de plus pour la recherche et les collections.
--
-- `saga_checked` distingue « pas encore interrogé » (0) de « interrogé, ce
-- film n'appartient à aucune saga » (1) : la détection rétroactive
-- (`detect_sagas`) ne retraite ainsi jamais deux fois le même titre.
ALTER TABLE titles ADD COLUMN saga_tmdb_id INTEGER;
ALTER TABLE titles ADD COLUMN saga_name TEXT;
ALTER TABLE titles ADD COLUMN saga_checked INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_titles_saga ON titles(saga_tmdb_id) WHERE saga_tmdb_id IS NOT NULL;
