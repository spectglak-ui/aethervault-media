# Changelog

Toutes les modifications notables apportées à ce projet seront documentées dans ce fichier.

## [0.7.0 « Orbite »] - 2026-10-09

### Ajouté
- **Nouvelle identité visuelle « Orbite »** : page de transition AetherFy (choix Vidéo / Musique), accueil repensé (« À la une », « Vos univers », « Ajouts récents », « En chiffres »), en-têtes et surfaces modernes sur les pages Catégories, Paramètres, Profils, Time Capsule, Partage, Collections, Explorer, TV, AetherFy Vidéo et Musique, Lecture et Privé
- **Fonds intégrés** : image « Voie lactée » et fond animé « Ciel de carrés », sélectionnables dans Paramètres (fonds personnels toujours possibles)

### Corrigé
- **Fuite audio HLS** : l'audio d'une chaîne TV pouvait continuer 5 à 10 s après le retour sur la grille (rechargement différé d'`attach_surface` relancé après l'arrêt)
- **Menu de suggestions de la recherche** : toujours affiché au premier plan
- **Barre latérale** : entrée TV en double (menant à `/category/tv`) retirée
- **Avertissements Rust** : plus aucun warning à la compilation

### Changé
- **Version** : 0.7.0 « Orbite » (remplace l'étiquette « Alpha » affichée dans Paramètres)
- **Fond d'AetherFy Vidéo** : transparent, c'est le fond du logiciel qui apparaît

## [0.5.7] - 2026-09-18

### Ajouté
- **Nettoyage automatique des fichiers temporaires** : Timer 24h pour supprimer les fichiers temporaires âgés
- **Buffer audio configurable** : Paramètre `AUDIO_BUFFER_MS` (250-2000ms) pour adapter la performance
- **Constantes nommées Start Gate** : Remplacement des magic numbers par des constantes explicites
- **Support multiplateforme** : Installateurs Windows NSIS, macOS DMG, Linux DEB/AppImage

### Corrigé
- **Gestion d'erreur Cobalt** : Remplacement de `.unwrap()` dangereux par gestion optionnelle sécurisée (ligne 1188)
- **Détection suppressions de fichiers** : Implémentation de `notify::EventKind::Remove` dans le watcher
- **Deadlock potentiel Share Manager** : Gestion sécurisée des poison locks avec `unwrap_or_else`
- **Politique de mot de passe** : Validation renforcée (8+ caractères, maj/min/chiffres/spéciaux)

### Changé
- **Version** : Passage de 0.4.0-alpha à 0.5.7
- **Architecture** : Amélioration de la robustesse et de la sécurité

## [0.3.0] - 2026-08-31
### Corrigé
- Remplacement des binaires d'installation Windows (.exe / .msi) par des versions corrigées et commités dans le dépôt. (commit: 54c709bd7d48eff4bf16ab64dea11c528b06e6ed)

### Notes
- Le numéro de version reste `0.3.0`. Le correctif concerne uniquement les artefacts d'installation fournis (installateurs).
- Voir le README.md pour les instructions d'installation et la mention du correctif.

