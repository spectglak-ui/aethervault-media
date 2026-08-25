# @aethervault/shared-types

Types TypeScript partagés entre les modules frontend, miroirs manuels des
structures Rust exposées par les commandes Tauri (voir les commentaires de
chaque fichier pour la structure backend correspondante).

Package "source-only" : pas d'étape de build séparée, consommé directement
par `apps/desktop` via un alias Vite/TS pointant vers `src/index.ts`.
