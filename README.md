# AetherVault Media

<div align="center">

![AetherVault Media](https://github.com/user-attachments/assets/7e06c1df-64e5-432f-8955-c7d7f95c328f)

**Votre médiathèque personnelle, locale et sous votre contrôle**

[![Licence MIT](https://img.shields.io/badge/Licence-MIT-yellow.svg)](LICENSE.txt)
[![Rust](https://img.shields.io/badge/Backend-Rust-CE422B?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/Frontend-TypeScript-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tauri](https://img.shields.io/badge/Framework-Tauri%202-FFC131?logo=tauri)](https://tauri.app/)

[Découvrir les fonctionnalités](#fonctionnalités) · [Installer](#installation) · [Architecture](#architecture) · [Contribuer](#contribuer)

</div>

---

## Présentation

**AetherVault Media** est une application multimédia de bureau conçue pour organiser et consulter une bibliothèque personnelle depuis votre appareil. Elle associe une interface React à un backend Rust/Tauri et stocke les données de l’application localement.

- Bibliothèque pour films, séries, anime, documentaires et contenus de lecture
- Profils et suivi de progression
- Lecteurs vidéo, audio et de lecture numérique
- Coffre privé avec données chiffrées
- Métadonnées enrichies par des services externes configurables
- Application multiplateforme : Windows, macOS et Linux

**Version de l’application : 0.8.1**

[Site du projet](https://spectglak-ui.github.io/aethervault-website/#/) · [Documentation technique](docs/AetherVault-Media-Documentation-Technique.md) · [Changelog](CHANGELOG.md)

## Fonctionnalités

### Bibliothèque et découverte

- Catégories et collections pour les médias et les contenus de lecture
- Détection et organisation des saisons, épisodes, tomes et chapitres
- Recherche avec filtres et collections intelligentes
- Importation et surveillance des dossiers pour repérer les nouveaux fichiers
- Métadonnées et illustrations issues de sources en ligne ou locales

### Lecture

- Lecture vidéo avec le moteur libmpv et accélération matérielle lorsqu’elle est disponible
- Lecture audio et formats de lecture numérique
  (Amélioration audio recommandée : Pour une expérience sonore optimale avec AetherVault Media, nous vous conseillons d'utiliser FxSound, un égaliseur et amplificateur audio open-source pour Windows.) https://github.com/fxsound2/fxsound-app
- Reprise de lecture et suivi de progression par profil
- Fenêtre de lecteur séparée et mode image dans l’image selon le lecteur

> La disponibilité de certaines fonctions vidéo dépend de libmpv et des capacités de la plateforme. Consultez la section [Prérequis](#prérequis).

### Confidentialité et sécurité

- Application de bureau locale, sans compte de service obligatoire
- Coffre privé chiffré avec Argon2id et AES-256-GCM
- Métadonnées EXIF GPS exclues lors du traitement des images
- Les services de métadonnées en ligne nécessitent une connexion lorsqu’ils sont utilisés

## Prérequis

- **Rust** 1.77 ou plus récent
- **Node.js** 20 LTS ou plus récent
- **pnpm** 9 (`corepack enable` peut être utilisé pour l’activer)
- Les outils de compilation natifs requis par Tauri pour votre système : [Windows](https://v2.tauri.app/start/prerequisites/#windows), [macOS](https://v2.tauri.app/start/prerequisites/#macos) ou [Linux](https://v2.tauri.app/start/prerequisites/#linux)

Pour la lecture vidéo complète, installez une version compatible de **libmpv**. En développement, le binaire peut être placé dans `apps/desktop/src-tauri/libs/` : `libmpv-2.dll` sous Windows, `libmpv.dylib` sous macOS ou `libmpv.so` sous Linux.

## Installation

À la racine du dépôt :

```bash
pnpm install
pnpm dev
```

La commande `pnpm dev` lance l’application Tauri en mode développement avec rechargement du frontend.

Pour compiler l’application et produire les installateurs configurés pour votre plateforme :

```bash
pnpm build
```

Les formats de distribution configurés sont NSIS pour Windows, DMG pour macOS, et DEB/AppImage pour Linux. Les artefacts sont générés sous `apps/desktop/src-tauri/target/release/bundle/`.

## Architecture

Le dépôt est un monorepo pnpm :

```text
aethervault-media/
├── apps/
│   └── desktop/
│       ├── src/                 # Interface React et TypeScript
│       └── src-tauri/           # Application et backend Rust/Tauri
├── packages/
│   ├── shared-types/            # Types partagés
│   └── ui-kit/                  # Composants d’interface réutilisables
├── docs/                        # Documentation technique
└── pnpm-workspace.yaml
```

| Partie | Technologies |
|---|---|
| Interface | React 18, TypeScript 5, Vite 5 |
| Application de bureau | Tauri 2, Rust 2021 |
| Données | SQLite embarqué |
| Gestion des dépendances | pnpm 9 workspaces |

## Documentation

La [documentation technique](docs/AetherVault-Media-Documentation-Technique.md) détaille l’architecture, les choix techniques et la feuille de route. Les changements de version sont consignés dans le [changelog](CHANGELOG.md).

## Contribuer

Les contributions, rapports de bugs et suggestions sont bienvenus. Avant de proposer un changement, consultez la documentation technique et ouvrez une [issue](https://github.com/spectglak-ui/aethervault-media/issues) pour discuter des changements importants.

## Licence

AetherVault Media est distribué sous licence [MIT](LICENSE.txt). Certaines dépendances, notamment libmpv, peuvent être soumises à leurs propres licences ; consultez la documentation technique pour les détails.

<div align="center">

**Fabriqué avec Rust, TypeScript et ❤️**

Maintenu par [@spectglak-ui](https://github.com/spectglak-ui)

</div>
