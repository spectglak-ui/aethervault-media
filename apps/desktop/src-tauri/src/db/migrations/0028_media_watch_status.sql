-- Migration 0028 — Statuts de visionnage automatiques « À voir / En cours / Vu »,
-- PAR PROFIL et PAR FICHIER MÉDIA (un film = un fichier, un épisode = un fichier).
--
-- Principe : l'ABSENCE de ligne signifie « À voir » (état initial de tous les
-- médias — aucune ligne à créer au scan). Une ligne n'existe que pour les états
-- 'in_progress' (commencé, pas fini) et 'done' (vu).
--
-- Pourquoi une table dédiée plutôt que `playback_progress` : cette dernière est
-- effacée dès qu'un média est terminé (voir `domain::playback`), ce qui
-- faisait perdre l'information « déjà vu ». Elle reste la source de la
-- position de reprise ; `media_watch_status` est la source du statut.
--
-- completed_by (diagnostic du dosage de « Vu », NULL tant que 'in_progress') :
--   'ended'   fin du fichier atteinte
--   'credits' arrêt à l'approche / pendant le générique de fin détecté (outro)
--   'tail'    arrêt dans la queue de secours (générique inconnu)
--   'manual'  marqué à la main par l'utilisateur

CREATE TABLE media_watch_status (
    profile_id    INTEGER NOT NULL REFERENCES profiles(id)    ON DELETE CASCADE,
    media_file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    status        TEXT    NOT NULL CHECK (status IN ('in_progress', 'done')),
    completed_by  TEXT    CHECK (completed_by IN ('ended', 'credits', 'tail', 'manual')),
    updated_at    TEXT    NOT NULL,
    PRIMARY KEY (profile_id, media_file_id)
);
CREATE INDEX idx_media_watch_status_media ON media_watch_status(media_file_id);
CREATE INDEX idx_media_watch_status_profile_status ON media_watch_status(profile_id, status);

-- Reprise de l'existant (une seule fois, à la mise à jour) --------------------
-- 1) « Vu » : toute session d'historique qui s'était terminée à ≥ 95 % (ancien
--    seuil) — c'est exactement ce qui effaçait la progression.
INSERT OR IGNORE INTO media_watch_status (profile_id, media_file_id, status, completed_by, updated_at)
SELECT wh.profile_id, wh.media_file_id, 'done', 'tail', MAX(wh.ended_at)
FROM watch_history wh
WHERE wh.duration_seconds > 0
  AND wh.position_seconds / wh.duration_seconds >= 0.95
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = wh.profile_id)
  AND EXISTS (SELECT 1 FROM media_files m WHERE m.id = wh.media_file_id)
GROUP BY wh.profile_id, wh.media_file_id;

-- 2) « En cours » : toute progression existante d'au moins 30 s et 1 % (les
--    lignes déjà « Vu » ci-dessus l'emportent : INSERT OR IGNORE).
INSERT OR IGNORE INTO media_watch_status (profile_id, media_file_id, status, completed_by, updated_at)
SELECT pp.profile_id, pp.media_file_id, 'in_progress', NULL, pp.updated_at
FROM playback_progress pp
WHERE pp.duration_seconds > 0
  AND pp.position_seconds >= 30
  AND pp.position_seconds / pp.duration_seconds >= 0.01;
