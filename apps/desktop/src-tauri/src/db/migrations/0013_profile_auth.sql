-- Migration 0013 — Authentification des profils (Étape 6c).
--
-- Ajoute deux colonnes à la table `profiles` pour supporter l'authentification
-- par mot de passe et le code de récupération :
--   - `password_hash` : hash Argon2id (chaîne PHC standard) du mot de passe,
--     NULL si le profil n'a pas de mot de passe (accès direct).
--   - `recovery_code_hash` : hash Argon2id du code de récupération (format
--     `XXXX-XXXX-XXXX-XXXX`, affiché une fois à la création puis stocké hashé),
--     NULL si aucun code n'a été généré.
--
-- Les profils existants (créés avant cette migration) conservent NULL dans
-- ces deux colonnes, ce qui correspond au comportement actuel : accès direct
-- sans mot de passe. Aucun changement de comportement observable à cette étape.

ALTER TABLE profiles ADD COLUMN password_hash TEXT NULL;
ALTER TABLE profiles ADD COLUMN recovery_code_hash TEXT NULL;