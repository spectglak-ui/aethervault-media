-- Migration 0006 — Personnalisation générique (doc §6.6, Étape 5).
--
-- Remplace les colonnes `custom_banner_path`/`custom_poster_path` posées
-- au coup par coup sur `categories`/`titles` (migration 0004) par une seule
-- table polymorphe. Décision prise à l'Étape 5 : la personnalisation
-- (doc §6.6) est explicitement appelée à s'étendre à de futures entités
-- (bibliothèques privées, apparence générale de l'interface...) — ajouter
-- une colonne `custom_*_path` par entité et par usage à chaque fois
-- demanderait une migration de schéma à chaque nouvelle personnalisation.
-- Une table unique, indexée par (type d'entité, id, usage), n'en demande
-- plus aucune : ajouter la personnalisation d'un Épisode ou d'une future
-- Bibliothèque privée ne touchera que du code applicatif.
--
-- Comme pour `media_files.title_id`/`episode_id` (migration 0004),
-- `entity_id` n'a pas de clause `REFERENCES` inline : une même colonne ne
-- peut pas référencer deux tables différentes selon la ligne (`categories`
-- ou `titles`) — l'intégrité est assurée côté Rust (voir
-- `custom_image_repository::delete_all_for_entity`, appelée par
-- `title_repository::delete`), pas par une contrainte SQLite.
--
-- Les valeurs existantes (`categories.custom_banner_path`,
-- `titles.custom_poster_path`, `titles.custom_banner_path`) sont recopiées
-- avant que les colonnes sources ne soient supprimées, par précaution bien
-- qu'aucune installation existante n'ait pu les remplir : l'Étape 4 avait
-- posé les commandes de personnalisation côté backend, mais aucune UI ne
-- les appelait encore avant cette étape.

CREATE TABLE custom_images (
    entity_type TEXT NOT NULL CHECK (entity_type IN ('category', 'title')),
    entity_id INTEGER NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('banner', 'poster')),
    path TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id, purpose)
);

INSERT INTO custom_images (entity_type, entity_id, purpose, path, updated_at)
SELECT 'category', id, 'banner', custom_banner_path, updated_at
FROM categories
WHERE custom_banner_path IS NOT NULL;

INSERT INTO custom_images (entity_type, entity_id, purpose, path, updated_at)
SELECT 'title', id, 'poster', custom_poster_path, updated_at
FROM titles
WHERE custom_poster_path IS NOT NULL;

INSERT INTO custom_images (entity_type, entity_id, purpose, path, updated_at)
SELECT 'title', id, 'banner', custom_banner_path, updated_at
FROM titles
WHERE custom_banner_path IS NOT NULL;

ALTER TABLE categories DROP COLUMN custom_banner_path;
ALTER TABLE titles DROP COLUMN custom_poster_path;
ALTER TABLE titles DROP COLUMN custom_banner_path;
