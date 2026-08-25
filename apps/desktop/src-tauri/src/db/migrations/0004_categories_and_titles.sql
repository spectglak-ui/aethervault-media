-- Migration 0004 — Catégories et modèle de contenu (Titre/Saison/Épisode).
--
-- Étape 4, portée élargie suite à la clarification de l'architecture
-- fonctionnelle (doc technique, §6). Remplace le modèle "bibliothèque =
-- un type de média en texte libre, fichiers bruts sans regroupement" par :
--   - une entité Catégorie de premier ordre (§6.1) ;
--   - un modèle de contenu Titre/Saison/Épisode à deux natures (§6.3),
--     partagé par Films/Séries/Anime/Documentaires ;
--   - les relations Genre/Studio/Personne nécessaires à la recherche
--     multi-critères déjà prévue pour le Search Engine (§4.2).
--
-- Décisions volontaires pour cette migration :
--
-- 1. `libraries.media_type` (texte libre, migration 0002) N'EST PAS
--    supprimée ici, uniquement dépréciée. La remplacer proprement demande
--    (a) que les 5 catégories système existent déjà en base — elles sont
--    créées par `db::seed`, qui s'exécute APRÈS les migrations — puis (b)
--    de recopier chaque bibliothèque existante vers la catégorie
--    correspondante avant de pouvoir supprimer la colonne source sans
--    perdre l'information. Cette recopie est donc faite par
--    `db::seed::backfill_library_categories`, pas ici. Une migration
--    ultérieure pourra supprimer `media_type` une fois cette bascule
--    éprouvée ; la laisser en place entre-temps est un coût nul (colonne
--    inutilisée par le nouveau code, jamais lue).
--
-- 2. Les colonnes ajoutées aux tables existantes (`libraries.category_id`,
--    `media_files.title_id`, `media_files.episode_id`) sont volontairement
--    déclarées SANS clause `REFERENCES` inline. `ALTER TABLE ... ADD
--    COLUMN` avec contrainte de clé étrangère est autorisé par SQLite,
--    mais n'a jamais été exercé dans ce projet (les tables existantes ne
--    déclarent leurs clés étrangères qu'à la création, jamais par ALTER) ;
--    faute de pouvoir compiler et tester dans cet environnement (réseau et
--    toolchain indisponibles — voir les notes « ⚠️ » déjà présentes
--    ailleurs dans le code), le choix le plus sûr est de ne pas dépendre
--    d'un comportement non vérifié. L'intégrité référentielle de ces trois
--    colonnes est donc assurée explicitement côté Rust (repositories), pas
--    par SQLite : voir `category_repository::delete` et
--    `title_repository::delete`, qui détachent les lignes dépendantes
--    avant suppression plutôt que de compter sur un `ON DELETE`.

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    icon TEXT,
    banner_path TEXT,
    custom_banner_path TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

ALTER TABLE libraries ADD COLUMN category_id INTEGER;
CREATE INDEX idx_libraries_category_id ON libraries(category_id);

-- Titre : film ou série (§6.3). `kind` fige la nature à la création — un
-- Titre ne change jamais de nature après coup (créer un nouveau Titre
-- plutôt que de faire migrer ses Saisons/Épisodes serait toujours plus
-- simple et plus sûr que d'autoriser cette transition).
CREATE TABLE titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
    name TEXT NOT NULL,
    description TEXT,
    year INTEGER,
    -- Uniquement pertinent pour kind = 'movie' ; pour 'series', la durée
    -- vit au niveau de chaque épisode (voir doc §6.3).
    duration_seconds INTEGER,
    rating REAL,
    -- Chemin de l'affiche/bannière obtenue automatiquement (Metadata
    -- Service) et son éventuel remplacement manuel par l'utilisateur
    -- (Personalization Manager, §6.6). La colonne "custom_*" est
    -- toujours prioritaire sur la colonne automatique — jamais l'inverse,
    -- et jamais écrasée par un rafraîchissement ultérieur des métadonnées.
    poster_path TEXT,
    custom_poster_path TEXT,
    banner_path TEXT,
    custom_banner_path TEXT,
    -- Provenance de la métadonnée : 'local' (nom de fichier, Étape 4) ou
    -- une future clé de fournisseur en ligne (§3.4, §8 Étape 4). Permet de
    -- ne jamais faire passer une correspondance approximative locale pour
    -- une métadonnée confirmée par un fournisseur en ligne.
    metadata_source TEXT NOT NULL DEFAULT 'local',
    external_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_titles_category_id ON titles(category_id);

CREATE TABLE seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (title_id, season_number)
);

CREATE INDEX idx_seasons_title_id ON seasons(title_id);

CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    name TEXT,
    description TEXT,
    duration_seconds INTEGER,
    still_path TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (season_id, episode_number)
);

CREATE INDEX idx_episodes_title_id ON episodes(title_id);
CREATE INDEX idx_episodes_season_id ON episodes(season_id);

-- Genres, studios, personnes (acteurs/réalisateurs) : tables de jointure
-- plutôt que des champs texte, pour la recherche multi-critères déjà
-- prévue au Search Engine (§4.2) sans avoir à migrer le schéma plus tard.
CREATE TABLE genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE title_genres (
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (title_id, genre_id)
);

CREATE TABLE studios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE title_studios (
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    studio_id INTEGER NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
    PRIMARY KEY (title_id, studio_id)
);

CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    photo_path TEXT
);

CREATE TABLE title_credits (
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('actor', 'director')),
    character_name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (title_id, person_id, role)
);

-- Rattachement des fichiers déjà découverts par le File Scanner (Étape 2)
-- à un Titre (nature 'movie') ou un Épisode (nature 'series') — exclusif,
-- jamais les deux à la fois, appliqué par le Metadata Service
-- (`services::metadata`). Nullable : un fichier tout juste détecté et pas
-- encore apparié reste consultable tel quel (comportement déjà existant,
-- inchangé).
ALTER TABLE media_files ADD COLUMN title_id INTEGER;
ALTER TABLE media_files ADD COLUMN episode_id INTEGER;
CREATE INDEX idx_media_files_title_id ON media_files(title_id);
CREATE INDEX idx_media_files_episode_id ON media_files(episode_id);
