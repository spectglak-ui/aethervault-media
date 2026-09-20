# @aethervault/ui-kit

Design system partagé d'AetherVault Media : jetons de thème (`theme/tokens.css`),
`ThemeProvider`/`useTheme`, et composants réutilisables (`Button`, `NavItem`,
`SearchInput`, `Avatar`, `EmptyState`, `PageHeader`).

Package "source-only" : pas d'étape de build séparée. `apps/desktop` importe
directement `src/index.ts` via un alias Vite/TS — voir `apps/desktop/vite.config.ts`.

Toute nouvelle couleur/espacement doit être ajouté dans `theme/tokens.css`
(jamais codé en dur dans un composant), pour que le thème clair/sombre et les
futurs thèmes personnalisés (Étape 5) s'appliquent partout automatiquement.
