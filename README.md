# AetherVault Media

Centre multimédia personnel, local-first, inspiré de Jellyfin/Plex. Voir
`docs/AetherVault-Media-Documentation-Technique.md` pour l'architecture
complète et la roadmap.

**État actuel : Étape 3b — Playback Engine Bridge natif (Windows).** Les
étapes 0, 1, 2a, 2b et 3a sont terminées (shell applicatif, navigation,
bibliothèques, surveillance de dossiers, lecteur HTML5 de base). Cette
livraison remplace le moteur HTML5 par une intégration native de libmpv,
intégrée à la fenêtre AetherVault (jamais un lecteur externe), avec prise
en charge d'une véritable fenêtre détachée. Voir la documentation
technique, section « Étape 3 », pour le détail de ce qui est livré et de
ce qui reste hors périmètre (Linux/macOS notamment).

## Prérequis (Windows)

1. **Rust** — via [rustup](https://rustup.rs).
2. **Node.js LTS** (v20 ou supérieur).
3. **pnpm** — `corepack enable` (inclus avec Node ≥ 16.10), puis `corepack prepare pnpm@latest --activate`.
4. **Microsoft C++ Build Tools** — via le "Visual Studio Installer", charge de travail *Desktop development with C++* (nécessaire pour compiler les dépendances natives de Tauri).
5. **WebView2 Runtime** — préinstallé sur Windows 11 ; à installer manuellement sur Windows 10 si absent ([lien Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/)).
6. **libmpv (Étape 3b)** — le lecteur a besoin de `libmpv-2.dll` (build **LGPL**, voir doc §9 « Licence de libmpv ») déposée à côté de l'exécutable généré par `pnpm dev`/`pnpm build` (typiquement `apps/desktop/src-tauri/target/debug/` en développement). Sans ce fichier, le reste de l'application fonctionne normalement — seules les commandes de lecture renverront une erreur explicite (`PlaybackEngineState::Unavailable`). L'empaquetage automatique de ce binaire avec l'installateur est prévu à l'Étape 9, pas encore réalisée.

## Lancer le projet en développement

```bash
pnpm install
pnpm dev
```

Une fenêtre doit s'ouvrir avec le titre "AetherVault Media" et afficher :

```
✅ Backend initialisé correctement
Version            0.1.0
Base de données     C:\Users\<vous>\AppData\Roaming\com.aethervault.media\aethervault.db
Répertoire de logs  C:\Users\<vous>\AppData\Roaming\com.aethervault.media\logs
Profils enregistrés 1
```

## Compiler un exécutable

```bash
pnpm build
```

Produit les binaires/installateurs dans
`apps/desktop/src-tauri/target/release/bundle/`.

## Note sur cette livraison (Étape 3b)

Le socle des étapes 0 à 3a avait déjà été compilé et validé. Le nouveau
code de cette étape (`apps/desktop/src-tauri/src/services/playback_engine/`)
a été écrit avec le plus grand soin d'après l'ABI stable de libmpv et l'API
Win32, mais **n'a pas pu être compilé ni testé dans l'environnement de
génération** (pas de toolchain Windows, pas de GPU, pas d'accès réseau côté
assistant). Chaque fichier concerné porte une note « ⚠️ » identifiant
précisément les points à vérifier au premier `cargo build` (essentiellement
des noms exacts de symboles/constantes dans `windows-sys` et le client mpv,
pas des choix d'architecture). **Merci de lancer `pnpm install` puis
`pnpm dev` et de signaler toute erreur de compilation** : elle sera
corrigée avant de poursuivre.

## Structure du projet

Voir `docs/AetherVault-Media-Documentation-Technique.md`, section 5, pour le
détail de l'arborescence complète et sa justification.
