-- Migration v1 de vault.db — Bibliothèques privées (Étape 6a, doc §6.4 bis).
--
-- Reprend exactement la forme de l'ancienne table `private_libraries` de
-- `aethervault.db` (migration 0005, supprimée par la migration 0010 de la
-- base principale), désormais à l'intérieur du coffre chiffré. Aucun lien
-- vers `categories`/`libraries` (bases différentes de toute façon) :
-- l'isolation est ici garantie par le chiffrement du fichier lui-même, pas
-- seulement par une séparation logique de table.
--
-- Volontairement sans dossiers ni contenu (pas de scan, pas de vignettes) :
-- l'Étape 6a ne livre que les bibliothèques privées en tant que
-- "conteneurs" (créer/renommer/supprimer un espace Images ou Vidéos). Voir
-- l'Étape 6b pour l'association de dossiers et le contenu réel.

CREATE TABLE private_libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('images', 'videos')),
    name TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
