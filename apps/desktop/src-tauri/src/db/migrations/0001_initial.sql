-- Migration 0001 — Schéma initial d'AetherVault Media.
--
-- Une seule table pour l'instant : `profiles`, qui pose la fondation du
-- futur système multi-profil (Étape 6) sans en implémenter la logique
-- complète ici. Les tables des bibliothèques, médias, favoris, historique,
-- etc. seront ajoutées via de nouvelles migrations (0002, 0003...) aux
-- étapes correspondantes de la roadmap.
--
-- Règle pour toutes les migrations futures : uniquement du DDL (CREATE /
-- ALTER TABLE). Les données par défaut (seed) sont gérées séparément dans
-- `db::seed`, pour ne jamais mélanger "évolution du schéma" et "données".

CREATE TABLE profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    profile_type TEXT NOT NULL,
    created_at TEXT NOT NULL
);
