-- Migration 0008 — Permissions de profil (Étape 6a, doc §6.5).
--
-- Modèle hybride retenu : `profile_type` détermine des permissions PAR
-- DÉFAUT à la création (table de correspondance côté Rust, voir
-- `security::permissions`), matérialisées ici par trois colonnes
-- explicites, modifiables ensuite individuellement par un profil disposant
-- de `can_manage_profiles` — couvre le cas "personnalisé" de la doc sans
-- moteur de permissions générique séparé (pas de table à la `custom_images`,
-- volontairement : trois permissions connues et stables, contrairement au
-- nombre croissant d'entités personnalisables qui justifiait ce choix-là).
--
-- Backfill : sur une installation déjà existante (mise à jour), le seul
-- profil qui puisse exister avant cette étape est l'Administrateur par
-- défaut (`db::seed::ensure_default_profile`) — il reçoit toutes les
-- permissions. Sur une installation neuve, cette table est vide au moment
-- où cette migration s'exécute (les migrations s'appliquent avant
-- `db::seed`) : le backfill ci-dessous n'affecte alors aucune ligne, et
-- c'est `ensure_default_profile` qui insère directement les permissions
-- correctes pour le nouveau profil Administrateur.

ALTER TABLE profiles ADD COLUMN can_access_private INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN can_manage_global_settings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN can_manage_profiles INTEGER NOT NULL DEFAULT 0;

UPDATE profiles
SET can_access_private = 1,
    can_manage_global_settings = 1,
    can_manage_profiles = 1
WHERE profile_type = 'admin';
