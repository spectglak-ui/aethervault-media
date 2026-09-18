-- Migration 0010 — Suppression de l'ancienne table `private_libraries`
-- (Étape 6a, doc §6.4 bis).
--
-- Posée en fondation à l'Étape 4 (migration 0005) dans `aethervault.db`,
-- non chiffrée. Le chiffrement effectif du coffre, décidé à l'Étape 6a
-- (architecture A2 : AES-256-GCM applicatif sur un fichier séparé — voir
-- l'erratum en doc §6.4 bis, SQLCipher ayant été envisagé puis abandonné
-- en cours d'étape), impose que ces données vivent dans `vault.db`, pas
-- dans le catalogue public — une table recréée à l'identique y est posée
-- par `security::vault` (première migration du coffre).
--
-- Sûr de le faire par simple DROP, sans migration de données : comme
-- documenté dans la migration 0005 elle-même, cette table n'a jamais été
-- exposée par aucune commande Tauri et ne contient donc, par construction,
-- aucune ligne sur aucune installation existante.

DROP TABLE private_libraries;
