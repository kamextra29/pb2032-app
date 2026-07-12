# PB 2032 — Identification de branchements GRDF

Application web installable (PWA) pour l'identification, sur le terrain, des branchements gaz
du marché **Protection Branchements 2032** (GRDF). Elle fonctionne **hors ligne** sur Android
(saisie terrain) et sur Windows (travail de bureau).

**Production :** https://kamextra29.github.io/pb2032-app/

## Ce que fait l'application

- **Importer** le fichier Excel du client (« Annexe 7 PB 2032 »).
- **Rechercher** un branchement : scan du matricule compteur, recherche globale
  (rue, n°, nom, PCE, matricule), ou navigation commune → rue → n°, avec filtres d'état.
- **Compléter** chaque fiche : listes déroulantes du fichier client, calcul automatique de la
  pression (colonne V) en direct, correction des infos client avec traçabilité, ajout d'un
  branchement absent du fichier.
- **Photographier** l'intérieur des coffrets (compression automatique, nommage automatique
  `n°_rue_PCE`).
- **Exporter** le fichier Excel **strictement au format d'origine** (couleurs, listes, formules
  et onglet récapitulatif intacts — seules les valeurs saisies sont injectées) et un **ZIP**
  des photos renommées.
- **Mettre à jour** avec une nouvelle version du fichier client sans perdre les saisies déjà
  faites (fusion).

**Confidentialité :** le fichier client, les saisies et les photos restent **uniquement dans
l'appareil** (stockage local du navigateur). Rien n'est envoyé sur Internet ni publié dans ce
dépôt (les fichiers Excel sont exclus par `.gitignore`).

## Installer sur un téléphone Android

1. Ouvrir https://kamextra29.github.io/pb2032-app/ dans **Chrome**.
2. Menu ⋮ → **« Ajouter à l'écran d'accueil »** (ou « Installer l'application »).
3. Lancer l'application depuis l'icône **PB 2032**. Après le premier chargement, elle
   fonctionne **sans connexion**.

## Cycle d'utilisation

1. **Au bureau (ou sur le téléphone) :** importer le `.xlsx` fourni par le client.
2. **Sur le terrain :** compléter les fiches, prendre les photos.
3. **De retour :** exporter le `.xlsx` (à renvoyer au client) et le ZIP des photos
   (à déposer sur la plateforme d'archivage).

## Développement

- **Lancer les tests :** `npm test` (Node, `node --test`).
- **Serveur local :** servir la racine du dépôt en HTTP (ex. `python -m http.server 8743`)
  puis ouvrir `http://localhost:8743/`.
- **Architecture :** JavaScript pur (modules ES), aucune dépendance d'exécution hors
  [JSZip](https://stuk.github.io/jszip/) (vendoré). Logique métier testée dans `js/core/`,
  interface dans `js/ui/`, traitements lourds (lecture/écriture du fichier de 60 Mo) dans un
  Web Worker. Données locales en IndexedDB.
- **Spécification et plan :** `docs/superpowers/`.

## Mettre à jour l'application déployée

Modifier le code, **incrémenter la version du cache** dans `sw.js`
(`const CACHE = 'pb2032-vN'`), puis `git push` sur `main`. Au prochain lancement connecté, le
téléphone proposera « Nouvelle version disponible — Recharger ».
