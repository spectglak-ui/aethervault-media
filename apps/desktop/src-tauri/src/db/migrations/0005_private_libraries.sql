-- Migration 0005 — Fondation de la section privée (doc §6.4).
--
-- Pose uniquement la séparation *logique* des données de la catégorie
-- Privé, comme annoncé dans la roadmap de l'Étape 4 : une table entièrement
-- à part de `libraries` (pas de `category_id`, pas de lien avec
-- `categories`), pour ne jamais avoir à retrofitter cette isolation plus
-- tard. Même principe que la table `profiles` posée dès la migration 0001
-- "sans en implémenter la logique complète" : le verrouillage PIN/mot de
-- passe, le chiffrement du coffre (SQLCipher vs. chiffrement fichier OS,
-- doc §3.3) et les commandes Tauri qui exposeraient cette table au
-- frontend sont explicitement hors périmètre ici — livrés à l'Étape 6.
--
-- Aucune ligne n'est créée par cette migration ni par `db::seed` : la
-- table reste vide et inatteignable tant que l'Étape 6 n'a pas ajouté le
-- mécanisme d'authentification qui doit obligatoirement la protéger (doc
-- §6.4 : "aucune donnée [...] avant authentification, vérifiée côté Rust").

CREATE TABLE private_libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('images', 'videos')),
    name TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
