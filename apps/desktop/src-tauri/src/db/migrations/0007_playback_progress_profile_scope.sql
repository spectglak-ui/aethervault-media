-- Migration 0007 — Scoping de `playback_progress` par profil (Étape 6a).
--
-- `playback_progress` (migration 0003) a été posée avant l'existence réelle
-- du multi-profil : une seule ligne par fichier, tous profils confondus.
-- Sans effet observable tant qu'un seul profil existait en pratique
-- (l'Administrateur par défaut, jamais basculé) — mais l'Étape 6a introduit
-- la bascule réelle de profil (doc §6.5 : "Historique [...] lié à un média
-- et à un profil"), ce qui rend ce scoping nécessaire pour éviter qu'un
-- profil écrase la progression d'un autre sur le même fichier.
--
-- SQLite ne permet pas d'ajouter une colonne à une clé primaire existante
-- via ALTER TABLE : reconstruction complète de la table, comme documenté
-- pour toute évolution de ce type dans ce projet. Les lignes existantes
-- (nécessairement toutes d'un seul profil en pratique, jusqu'ici) sont
-- rattachées au premier profil de l'installation — le seul qui ait jamais
-- pu exister avant cette étape.

ALTER TABLE playback_progress RENAME TO playback_progress_old;

CREATE TABLE playback_progress (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    position_seconds REAL NOT NULL,
    duration_seconds REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, media_file_id)
);

INSERT INTO playback_progress (profile_id, media_file_id, position_seconds, duration_seconds, updated_at)
SELECT
    (SELECT id FROM profiles ORDER BY id ASC LIMIT 1),
    media_file_id,
    position_seconds,
    duration_seconds,
    updated_at
FROM playback_progress_old
WHERE EXISTS (SELECT 1 FROM profiles);

DROP TABLE playback_progress_old;
