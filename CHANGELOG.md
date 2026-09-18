# Changelog

Toutes les modifications notables apportées à ce projet seront documentées dans ce fichier.

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

