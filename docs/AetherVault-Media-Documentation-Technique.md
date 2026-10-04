# AetherVault Media — Documentation technique

## 1. Présentation

AetherVault Media est une application de bureau locale, orientée multimédia, conçue pour gérer une bibliothèque personnelle de films, séries, anime, documentaires et contenus privés sans dépendre d'un service cloud. L'application est structurée comme un produit desktop moderne à la fois performant, fiable et respectueux de la confidentialité.

Le projet repose sur une architecture hybride :
- un backend natif en Rust via Tauri,
- un frontend web en React + TypeScript,
- une base de données locale SQLite,
- un moteur de lecture vidéo libmpv,
- un coffre privé chiffré avec protection AES-256-GCM et dérivation Argon2id.

Le but est simple : offrir une expérience comparable à un centre multimédia premium, tout en conservant les médias sur l'appareil de l'utilisateur et en évitant toute dépendance à un serveur central.

---

## 2. Objectifs fonctionnels

### 2.1 Objectif produit

AetherVault Media vise à centraliser la gestion, la lecture et la protection des médias personnels dans une interface unique, cohérente et agréable à utiliser.

Les objectifs principaux sont :
- offrir un catalogue local riche et navigable,
- traiter les médias comme des entités structurées (titre, saison, épisode, collection, catégorie),
- préserver la confidentialité des contenus privés,
- rester performant malgré des bibliothèques volumineuses,
- fournir une expérience utilisateur premium sur ordinateur,
- rester extensible pour les futures évolutions (métadonnées, plugins, IA, import/export, synchronisation locale).

### 2.2 Contraintes de conception

Le produit est pensé pour répondre à plusieurs contraintes importantes :
- local-first : aucun stockage ou traitement externe obligatoire,
- confidentialité par défaut : accès au coffre privé strictement contrôlé,
- performances : scans, métadonnées et lecture doivent rester fluides,
- stabilité : les erreurs de fichiers, dossiers et médias ne doivent pas casser l'application,
- cohérence desktop : installation, mise à jour, fenêtre, intégration système, données utilisateur.

---

## 3. Choix techniques

### 3.1 Stack applicative

| Composant | Technologie | Rôle |
|---|---|---|
| Backend applicatif | Rust | logique métier, sécurité, accès aux données, scan des fichiers |
| Frontend | React + TypeScript | interface utilisateur, navigation, composants, états |
| Runtime desktop | Tauri 2 | intégration native, fenêtres, IPC, packaging |
| Base de données | SQLite | catalogue local, profils, préférences, historique |
| Lecture vidéo | libmpv | décodage, rendu, pistes audio/sous-titres |
| Sécurité | Argon2id + AES-256-GCM | coffre privé, profil utilisateur, protection des données |
| Build & tooling | pnpm + Vite + Rust toolchain | dev workflow, build, bundling |

### 3.2 Pourquoi Rust ?

Le choix de Rust n'est pas anodin :
- il permet un contrôle fin sur la mémoire et les performances,
- il apporte une fiabilité supérieure pour les scans de dossiers larges,
- il facilite la manipulation de fichiers lourds, des flux de médias et des métadonnées,
- il est bien adapté au besoin de sécurité critique autour du coffre privé.

Le backend est conçu pour être robuste face à des bibliothèques volumineuses ou des médias atypiques, sans perdre la stabilité globale de l'application.

### 3.3 Pourquoi Tauri ?

Tauri est un bon choix pour ce type de produit :
- il produit des applications de bureau légères,
- il laisse la logique métier côté Rust avec une interface côté web,
- il permet une intégration native autour des fenêtres et du système d'exploitation,
- il offre un bundle d'installation stable pour les environnements desktop.

Au niveau du produit, cela permet d'allier vitesse de développement sur le frontend et robustesse système sur le backend.

### 3.4 Pourquoi React + TypeScript ?

Le frontend est construit comme une interface de gestion de contenu moderne :
- navigation par catégories ;
- pages de détail et de collection ;
- lecteur intégré ;
- état local réactif ;
- composants modulaires pour une UI cohérente et maintenable.

Cette approche permet de produire rapidement une expérience premium tout en conservant une séparation claire avec la logique applicative côté Rust.

---

## 4. Architecture globale

### 4.1 Vue d'ensemble

L'architecture suit un modèle simple et cohérent :

```
UI React / TypeScript
    │
    ▼
Tauri IPC commands
    │
    ▼
Rust application layer
    │
    ├── domain
    ├── services
    ├── db
    ├── security
    ├── commands
    └── state
    │
    ▼
SQLite + filesystem + media engine
```

### 4.2 Couches logiques

#### Couche UI
La couche frontend gère :
- l'accueil,
- les pages de contenu,
- l'authentification et sélection de profil,
- le lecteur,
- les outils de navigation et de personnalisation.

#### Couche application
Elle orchestre les grands flux applicatifs :
- bibliothèques,
- lecture,
- métadonnées,
- profil utilisateur,
- sécurité,
- watch de fichiers,
- fichiers privés.

#### Couche services
C'est le cœur technique du produit :
- scan de dossiers,
- détection de fichiers,
- métadonnées et analyse de contenu,
- génération de vignettes,
- traitement des images,
- surveillance en temps réel,
- lecture multimédia via libmpv.

#### Couche données
La base locale contient :
- les catalogues de médias,
- les bibliothèques,
- les métadonnées,
- les préférences,
- les profils et les notions d'accès,
- les éléments liés à la sécurité et au coffre privé.

---

## 5. Structure du projet

Le dépôt est organisé selon un monorepo.

```text
aethervault-media/
├── apps/
│   └── desktop/
│       ├── src-tauri/              # Backend Rust / Tauri
│       │   ├── src/
│       │   │   ├── commands/        # IPC handlers
│       │   │   ├── db/              # migrations + repositories
│       │   │   ├── domain/          # modèles métier
│       │   │   ├── security/        # coffre chiffré, profils, authentification
│       │   │   ├── services/        # scan, metadata, watcher, mpv, images
│       │   │   ├── state.rs         # état partagé applicatif
│       │   │   ├── lib.rs           # bootstrap Tauri
│       │   │   └── main.rs          # point d'entrée
│       │   ├── Cargo.toml
│       │   └── libs/
│       └── src/                    # Frontend React/TypeScript
│           ├── pages/
│           ├── components/
│           ├── layout/
│           ├── player/
│           ├── services/
│           ├── hooks/
│           ├── theme/
│           ├── App.tsx
│           ├── router.tsx
│           └── main.tsx
├── packages/
│   ├── shared-types/
│   └── ui-kit/
├── assets/
│   └── branding/
├── docs/
├── scripts/
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── LICENSE.txt
└── CHANGELOG.md
```

---

## 6. Gestion des médias et de la bibliothèque

### 6.1 Modèle de contenu

Le système traite les médias comme des objets structurés plutôt que comme des fichiers bruts isolés. Le modèle couvre :
- catégorie (films, séries, anime, documentaires, privé),
- bibliothèque,
- titre,
- saison,
- épisode,
- fichier média,
- métadonnées techniques.

Cela permet de construire une navigation cohérente, de gérer les collections et d'aligner les pages de détail avec une logique documentaire plutôt que le simple stockage de fichiers.

### 6.2 Scan des bibliothèques

Le backend intègre un flux de scan de dossiers destinés à l'indexation locale des médias. Le scan prend en charge :
- détection récursive des fichiers,
- filtrage sur les formats supportés,
- enrichissement des métadonnées,
- catégorisation,
- génération de vignettes,
- mise à jour des index et du cache local.

Cette étape est essentielle pour rendre la bibliothèques exploitable sans connexion externe.

### 6.3 Surveillance des dossiers

Le projet inclut un mécanisme de surveillance de fichiers, via des technologies adaptées à la plateforme, dans le but d'ajouter automatiquement des contenus à la bibliothèque lorsque des fichiers sont ajoutés, supprimés ou déplacés.

Cette logique est importante pour éviter qu'une médiathèque locale ne devienne rapidement obsolète ou incohérente.

---

## 7. Lecture multimédia

### 7.1 Moteur utilisé

Le moteur de lecture est basé sur libmpv, qui apporte :
- support large des codecs,
- lecture de nombreux formats vidéos,
- gestion des pistes audio et sous-titres,
- intégration directe dans une expérience desktop.

### 7.2 Intégration applicative

Le lecteur est intégré dans le shell desktop Tauri via un flux orchestré côté Rust et présenté dans le frontend. La logique de lecture est séparée de l'UI pour faciliter le maintien et l'évolution.

Les points importants sont :
- séparation entre UI et moteur,
- contrôle de lecture par commandes IPC,
- gestion des états de lecture,
- adaptation au contexte plein écran / flottant / intégré,
- gestion des pistes disponibles.

### 7.3 Points techniques à surveiller

Les défis connus du lecteur multimédia sont :
- compatibilité des codecs selon les plateformes,
- acuité de l'accélération GPU,
- synchronisation audio/vidéo,
- perf sur fichiers volumineux,
- stabilité avec les dossiers et fichiers atypiques.

C'est précisément pour cette raison que le backend a été conçu pour isoler le pont de lecture dans des services spécifiques.

---

## 8. Sécurité et confidentialité

### 8.1 Principe central

AetherVault Media ne se contente pas d'ajouter une couche de sécurité : la confidentialité est un principe architectural.

Le système distingue clairement :
- bibliothèque publique,
- bibliothèque privée,
- profils utilisateurs,
- accès à l'espace privé selon les autorisations.

### 8.2 Coffre privé

Le coffre privé est protégé avec :
- chiffrement AES-256-GCM,
- dérivation de clé Argon2id,
- stockage local séparé du catalogue public,
- accès contrôlé par profil.

Cela permet de sécuriser les contenus sensibles sans dépendre d'un service externe ou d'une base centralisée.

### 8.3 Gestion des profils

Le logiciel supporte plusieurs profils utilisateur avec différents niveaux d'autorisation. Cela permet :
- de séparer les contextes d'usage,
- d'organiser la couche privée indépendamment du catalogue public,
- d'anticiper les usages familiaux ou multi-utilisateurs.

### 8.4 Sécurité applicative

Les bonnes pratiques déjà appliquées ou prévues :
- pas de dépendance à un backend distant pour le cœur du produit,
- données sensibles stockées localement,
- chiffrement appliqué au contenu privé,
- aucune exposition non contrôlée des données,
- séparation claire entre logique de sécurité et logique d'UI.

---

## 9. Base de données locale

### 9.1 SQLite comme fondement

SQLite est le choix de base de données par défaut, pour plusieurs raisons :
- faible friction d'installation,
- excellente adéquation aux applications desktop locales,
- support fiable pour les usages de lecture, indexation et cache local,
- facilité de versioning via migrations.

### 9.2 Contenu stocké localement

La base héberge les informations structurelles du produit :
- bibliothèques et catégories,
- titres et collections,
- profils,
- préférences applicatives,
- historique / favoris / progression,
- données liées au privé et à la personnalisation.

### 9.3 Migrations

Le projet adopte une logique versionnée avec migrations SQL. Cela permet :
- de faire évoluer le schéma sans réécrire la base,
- de maintenir la compatibilité entre versions,
- de sécuriser la montée de version logicielle.

---

## 10. Métadonnées et personnalisation

### 10.1 Métadonnées

Le système est pensé pour enrichir les médias à partir de différents fournisseurs :
- métadonnées locales,
- inspection de fichiers,
- nom de fichier structurés,
- intégration de sources externes comme TMDB,
- cache local pour fonctionner hors ligne.

### 10.2 Personnalisation visuelle

AetherVault Media met l'accent sur la personnalisation visuelle :
- bannières de catégories,
- affiches par titre,
- fonds visuels,
- adaptation du thème et du rendu global,
- navigation orientée média.

Cette dimension est un point clé du produit et non une fonctionnalité secondaire.

---

## 11. Flux applicatifs principaux

### 11.1 Démarrage de l'application

Au démarrage, le backend :
1. initialise le répertoire de données utilisateur,
2. crée le pool de connexion SQLite,
3. applique les migrations,
4. initialise les données par défaut,
5. charge les services nécessaires,
6. prépare l'état applicatif partagé.

### 11.2 Ajout d'un média

Le flux standard est le suivant :
1. utilisateur ajoute ou configure une bibliothèque,
2. le système traverse les dossiers ciblés,
3. les fichiers sont détectés et classés,
4. les métadonnées sont calculées,
5. les entrées sont enrichies et persistées,
6. les vignettes et données de navigation sont mises à jour.

### 11.3 Lecture d'un média

Le flux de lecture est le suivant :
1. le frontend envoie l'intention de lecture,
2. le backend charge le média dans le moteur de lecture,
3. libmpv prend le contrôle du rendu,
4. l'UI affiche les détails et les contrôles,
5. la progression et les événements de lecture sont synchronisés.

---

## 12. Packaging et distribution desktop

Le projet cible la distribution native via Tauri pour les ordinateurs de bureau.

### 12.1 Installateurs

L'application est conçue pour générer des paquets d'installation selon la plateforme :
- Windows : NSIS / bundle Windows,
- macOS : DMG / bundle macOS,
- Linux : DEB / AppImage selon la cible.

### 12.2 Données utilisateur

Les données utilisateur sont directement stockées dans le dossier d'application standard du système d'exploitation, sans altérer les fichiers du programme dans le dossier d'installation.

Cela permet :
- de préserver la persistance des données,
- d'éviter les conflits de mise à jour,
- de nettoyer proprement les installations sans supprimer la bibliothèque utilisateur.

### 12.3 Libmpv et conformité

libmpv est chargé dynamiquement et non lié statiquement. Cela est important pour la licence et la compatibilité du produit. L'application garde une architecture plus propre et évite de porter des contraintes de licence trop lourdes sur l'ensemble du produit.

---

## 13. État actuel du projet

Le dépôt actuel montre un projet déjà avancé, avec les éléments suivants :
- architecture backend Rust + frontend React bien structurée,
- support de la sécurité par profil et coffre privé,
- lecture multimédia centralisée,
- support des bibliothèques, métadonnées, vignettes, scan, recherche,
- système de personnalisation avec thèmes et images,
- intégration Tauri pour la distribution desktop.

Le produit n'est donc pas un prototype de démonstration : il s'agit d'un vrai logiciel applicatif desktop, conçu pour servir une médiathèque locale dans un contexte d'usage réel.

---

## 14. Roadmap technique

### Court terme
- stabilisation des scans et de la surveillance des dossiers,
- consolidation des pipelines de métadonnées,
- amélioration des cibles de lecture et des performances,
- validation sur plusieurs configurations.

### Moyen terme
- enrichissement des fournisseurs de métadonnées et cache local,
- optimisation de la recherche et des facettes,
- amélioration de l'expérience de navigation et de personnalisation,
- tests de robustesse sur fichiers volumineux ou atypiques.

### Long terme
- extensibilité par plugins,
- intégration de fonctionnalités IA ou d'assistance locale,
- amélioration du système de partage et de distribution,
- support plus large de formats, de dossiers et de scénarios d'usage.

---

## 15. Recommandations de développement

Pour conserver la qualité technique du projet, il est conseillé de garder les principes suivants :
- séparer clairement la logique UI et la logique métier,
- maintenir la couche de sécurité comme point d'entrée des règles d'accès,
- garder les scans et traitements lourds hors de la boucle UI,
- ne pas mélanger stockage local, données publiques et données privées,
- respecter les migrations et versionner les évolutions de schéma,
- tester chaque ajout de lecteur, scan ou métadonnée sur des cas réels.

---

## 16. Conclusion

AetherVault Media est un projet desktop sérieux, orienté media local, conçu pour répondre à un besoin réel : gérer une bibliothèque multimédia personnelle de manière fiable, élégante et sécurisée, sans dépendre d'un service cloud.

La combinaison de Rust, Tauri, SQLite, React et libmpv constitue une base solide pour une application de bureau performante et extensible. Le vrai atout du produit n'est pas seulement le lecteur, mais l'ensemble du système : organisation des contenus, confidentialité, métadonnées, personnalisation et robustesse logique.

C'est une architecture pensée pour évoluer sur plusieurs années, avec un bon niveau de qualité technique dès le départ.

---

## 17. Références utiles

- README principal : `README.md`
- Documentation technique détaillée : `docs/AetherVault-Media-Documentation-Technique.md`
- Package d'application : `apps/desktop/package.json`
- Backend Tauri : `apps/desktop/src-tauri/Cargo.toml`
- Licence : `LICENSE.txt`

