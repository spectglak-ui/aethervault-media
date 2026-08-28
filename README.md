# AetherVault Media

<img width="1919" height="635" alt="AetherVault Media - Centre multimédia personnel" src="https://github.com/user-attachments/assets/9152b0d9-8d67-4511-b3d8-588f48f80259" />

**AetherVault Media** est un centre multimédia personnel, **local-first**, entièrement installé sur votre appareil. Gérez votre bibliothèque de films, séries, anime et galeries privées — sans cloud, sans partage de données — avec un design moderne inspiré de Jellyfin et Plex.

**État actuel** : 🎬 Étape 8 livrée — Installateur Windows NSIS et lecteur intégré avec libmpv.

## 🌟 Fonctionnalités principales

### 📚 Gestion de bibliothèque
- **Catalogue public** : films, séries et anime avec détection automatique des saisons et épisodes
- **Coffre privé chiffré** : vidéos et galeries d'images protégées en AES-256-GCM
- **Métadonnées enrichies** : intégration TMDB (synopsis, affiches, casting, genres, notes)
- **Profils multi-utilisateurs** : authentification avec intro animée et sélection de profil
- **Watcher automatique** : détecte les nouveaux fichiers médias en temps réel

### 🎥 Lecteur multimédia intégré
- **Lecteur libmpv** : rendu logiciel + canvas WebGL pour une compatibilité maximale
- **Modes de lecture** : lecture plein écran, mode flottant, Picture-in-Picture
- **Shaders de post-traitement** : 4 presets WebGL (Désactivé, Netteté, Couleurs vives, Anime4K-lite)
- **Informations techniques** : résolution, codecs, langues audio et sous-titres

### 🔍 Exploration et recherche
- **Explorateur multicritère** : recherchez par titre, catégorie, année, genre, acteur, réalisateur, résolution, codec, langue
- **Facets intelligentes** : navigation intuitive avec compteur de résultats
- **Barre de recherche globale** : accès rapide via le shell
- **Fonds d'écran** : bannières TMDB automatiquement appliquées aux pages titre

### 🏠 Interface utilisateur
- **Accueil v2** : héro à la une avec synopsis et boutons d'action, rangées style Netflix
- **Fenêtre frameless** : design moderne sans barre de titre native, draggable
- **Thème cohérent** : scrollbars sombres et personnalisation complète
- **Maximisée au démarrage** : expérience immersive dès le lancement

### ⚡ Performance et sécurité
- **Vignettes d'aperçu automatiques** : extraites à ~1s de chaque épisode, génération efficace
- **Barre de progression du scan** : suivi en temps réel (analyse → appariement → vignettes)
- **Chiffrement du coffre** : Argon2id (KDF) + AES-256-GCM, jamais en clair sur disque
- **Aucune dépendance système** : SQLite bundled, rustls (100% Rust)

## 📋 Prérequis (Windows)

### Outils obligatoires
- **Rust** — installez via [rustup](https://rustup.rs)
- **Node.js LTS** — version 20 ou supérieure
- **pnpm** — gestionnaire de paquets (installé via `corepack` inclus avec Node ≥ 16.10)
  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  ```
- **Microsoft C++ Build Tools** — depuis Visual Studio Installer (charge de travail : *Desktop development with C++*)
- **WebView2 Runtime** — préinstallé sur Windows 11 ; à [installer manuellement](https://developer.microsoft.com/microsoft-edge/webview2/) sur Windows 10

### 🎬 libmpv-2.dll (crucial)
Le lecteur multimédia nécessite **libmpv-2.dll** (build LGPL, non modifié) :

#### Pour le mode développement
```bash
# Téléchargez la build LGPL de libmpv
# Déposez libmpv-2.dll à côté de l'exécutable :
apps/desktop/src-tauri/target/debug/libmpv-2.dll
```

Sans ce fichier, le reste de l'application fonctionne — seules les commandes de lecture retourneront une erreur explicite (`PlaybackEngineState::Unavailable`).

#### Pour l'installation (Étape 8)
```bash
# Avant de lancer tauri build :
cp libmpv-2.dll apps/desktop/src-tauri/libs/

# L'installateur embarquera automatiquement le binaire dans :
<installation>\resources\libmpv-2.dll
```

## 🚀 Installation et utilisation

### Mode développement

**Installation initiale** :
```bash
pnpm install
pnpm dev
```

L'application se lance en mode debug avec hot-reload Vite.

### Mode production — Installateur NSIS

**Générer l'installateur** :
```bash
# Assurez-vous que libmpv-2.dll est dans apps/desktop/src-tauri/libs/
pnpm build
```

Cela produit :
```
apps/desktop/src-tauri/target/release/bundle/nsis/AetherVault Media_0.1.0_x64-setup.exe
```

**Installation** :
- Interface de sélection de langue (FR/EN)
- Installation par utilisateur (sans UAC)
- Raccourci automatique au Menu Démarrer
- Inscription dans « Applications installées »
- Désinstallation complète et propre

**Données utilisateur** : Les données sont stockées dans `%APPDATA%` et ne sont jamais modifiées par l'installation ou la désinstallation.

**Notes** :
- ⚠️ Signature de code non incluse (avertissement SmartScreen possible au premier lancement)
- ⚠️ Tauri Updater non implémenté
- Premier build télécharge l'outil NSIS automatiquement (connexion requise une seule fois)

## 🏗️ Architecture

### Stack technologique
- **Backend** : Rust 2021 (1.77+) avec Tauri 2
- **Frontend** : React 18 + React Router 6 + TypeScript 5
- **Outils de build** : Vite 5, pnpm 9.0.0
- **Base de données** : SQLite (rusqlite bundled)
- **Lecteur vidéo** : libmpv (chargement dynamique)

### Structure monorepo (pnpm workspaces)
```
aethervault-media/
├── apps/
│   └── desktop/
│       ├── src-tauri/          # Rust (Tauri)
│       ├── src/                # React + TypeScript
│       └── src-tauri/libs/     # libmpv-2.dll (à copier avant build)
├── packages/
│   ├── shared-types/           # Types TypeScript partagés
│   └── ui-kit/                 # Composants React réutilisables
└── pnpm-workspace.yaml         # Configuration du monorepo
```

### Dépendances principales (Rust)

| Domaine | Crates | Notes |
|---------|--------|-------|
| **Base de données** | `rusqlite`, `r2d2`, `r2d2_sqlite` | SQLite bundled, connection pooling |
| **Chiffrement** | `aes-gcm`, `argon2`, `rand` | AES-256-GCM + Argon2id KDF, 100% Rust |
| **Multimédia** | `image`, `kamadak-exif` | Décodage images, EXIF (sans GPS) |
| **Réseau** | `ureq` | Client HTTP Rust pur (rustls) |
| **Système de fichiers** | `walkdir`, `notify` | Récursion + watcher temps réel |
| **Lecteur vidéo** | `libloading` | Chargement dynamique de libmpv |
| **Parallélisation** | `rayon` | Scan d'images en parallèle |
| **Frontend bridge** | `tauri`, `tauri-plugin-log`, `tauri-plugin-dialog` | IPC et plugins Tauri 2 |

### Principes de sécurité
- ✅ Aucune dépendance C système (rustls, Rust pur)
- ✅ Chiffrement du coffre entièrement applicatif (niveau SQLite, pas SQLCipher)
- ✅ libmpv chargée dynamiquement (pas d'héritage GPL, licence propre AetherVault)
- ✅ Données sensibles jamais en clair sur disque
- ✅ Pas de hash de mot de passe stocké (KDF Argon2id uniquement)

## 🔐 Licence

AetherVault Media est publié sous la **Licence MIT**.

**Note spéciale sur libmpv** : libmpv-2.dll (inclus dans l'installateur) est distribué sous licence LGPL. Voir la documentation technique (§9) pour les détails de conformité.

## 📖 Documentation complète

Pour l'architecture détaillée, le plan de développement (roadmap), les choix techniques et les étapes de livraison :

👉 **[docs/AetherVault-Media-Documentation-Technique.md](docs/AetherVault-Media-Documentation-Technique.md)**

## 🤝 Contribution

Ce projet est actuellement en développement actif. Les contributions sont bienvenues — consultez la documentation technique pour comprendre l'architecture avant de soumettre des pull requests.

## 📬 Support et retours

Pour les questions, bugs ou suggestions d'amélioration, ouvert les issues sur GitHub.

---

**Dernière mise à jour** : Étape 8 — Septembre 2026  
**Mainteneur** : [@spectglak-ui](https://github.com/spectglak-ui)
```

---

## 📝 Résumé des points clés intégrés

✅ **Présentation** : Centre multimédia personnel local-first, inspiré de Jellyfin/Plex  
✅ **Fonctionnalités** : Catalogue public, coffre chiffré, métadonnées TMDB, lecteur libmpv, explorer multicritère, UI moderne  
✅ **Prérequis** : Rust, Node.js LTS, pnpm, Microsoft C++ Build Tools, WebView2, **libmpv-2.dll**  
✅ **Installation** : Mode dev (`pnpm dev`), Mode prod avec installateur NSIS  
✅ **Architecture** : Tauri/Rust (backend) + React/TypeScript (frontend), pnpm monorepo avec workspace  
✅ **Licence** : MIT (+ note spéciale LGPL pour libmpv)  
✅ **État** : Étape 8 livrée, compilée et testée Windows