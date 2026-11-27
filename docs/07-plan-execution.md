# 07. Plan d'exécution : Learning Locker 2026

> [Index de la documentation](README.md) · Rédigé le 26 novembre 2026. Ce plan met en œuvre l'analyse de [06-migration-2026.md](06-migration-2026.md) sur la VM de travail.

## 1. VM de travail (vérifiée le 26/11/2026)

Accès : `ssh -p 2222 sam@localhost`.

| Élément | Constat | Conséquence |
|---|---|---|
| OS | Ubuntu Server **24.04.5 LTS**, noyau 6.8 | Couple officiel avec **MongoDB 8.0**. C'est le choix retenu (cf. 06 §6.1). |
| CPU | 12 vCPU (i7-1365U), **AVX et AVX2 présents** | MongoDB ≥ 5.0 exige AVX : OK. |
| Mémoire | 7,8 Go, swap 4 Go | Suffisant pour la pile cible et une pile de référence en Docker, sans plus. |
| Disque | Disque de 64 Go, mais LV `/` de **31 Go seulement** (23 Go libres). 31 Go non alloués dans le VG. | Étendre le LV avant d'importer des données (§2). |
| Fuseau | UTC, NTP actif | Conforme (le scheduler raisonne en heure locale). |
| Réseau | NAT QEMU (`10.0.2.15`), seul le port 22 est redirigé (vers 2222 sur l'hôte). Accès Internet OK (NodeSource, dépôt MongoDB). | Ajouter une redirection HTTP pour tester depuis l'hôte (§2). |
| Droits | `sam` est dans le groupe `sudo`, mais **sudo demande un mot de passe** | Je ne peux rien installer en autonomie (§2). |
| Logiciels | `git` et `python3` seulement. Pas de Node, MongoDB, Redis, nginx, Docker ni compilateur. 35 paquets à mettre à jour. | VM vierge : tout le socle est à installer. |

## 2. Préalables (côté utilisateur)

1. **Autoriser sudo sans mot de passe pour `sam`**, au moins pendant la mise en place :
   ```bash
   echo 'sam ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/90-sam && sudo chmod 440 /etc/sudoers.d/90-sam
   ```
   Il faudra le retirer une fois la VM stabilisée. Alternative : je fournis les commandes et tu les exécutes.
2. **Redirection de ports** dans la configuration QEMU/libvirt de la VM : par exemple `hostfwd=tcp::8080-:80`, pour ouvrir l'application dans le navigateur de l'hôte.
3. **Instantané de la VM** dans son état vierge actuel, pour pouvoir revenir en arrière.
4. Réponses aux questions du §3.

## 3. Décisions à prendre

Ce sont les questions ouvertes de [06 §10](06-migration-2026.md). Le plan suit la valeur par défaut tant qu'il n'y a pas de réponse.

| # | Décision | Défaut proposé |
|---|---|---|
| D1 | Existe-t-il une instance en production (volume, version d'xapi-service) ? | **Réponse (26/11/2026) : oui**, ses données seront migrées, mais à la fin (lot 9). D'ici là, développement et tests sur le jeu de test généré (lot 1). À fournir au lot 9 : versions (LL, xapi-service, MongoDB, Redis), volume, options activées, `inventory.json` de la base (sans données personnelles). |
| D2 | Fonctionnalités optionnelles réellement utilisées | Livrer Redis + stockage local. SQS, Pub/Sub, Service Bus, GCS, Azure, Rackspace, New Relic et CloudWatch sont reportés ; le démarrage échoue proprement si ces valeurs sont configurées. **Validé (26/11/2026)** : la production utilise Redis. |
| D3 | Backend : réécriture TypeScript ou montée de version sur place | Réécriture TypeScript (NestJS 11 sur Express 5) à contrat figé. **Validé (26/11/2026).** |
| D4 | Où vit le nouveau code | Branche `v2026` du fork `profenpoche/learninglocker`, en **monorepo** (npm workspaces). L'ancien code reste sur `master` comme référence. xapi-service reste dans son propre fork. **Validé (26/11/2026).** |
| D5 | Node.js | **Node 24 LTS** (support jusqu'en avril 2028). Angular 22 et les drivers récents y sont validés. Passage à Node 26 dans un second temps. **Validé (26/11/2026).** |
| D6 | File de messages | **BullMQ**, mêmes noms de files `${QUEUE_NAMESPACE}_<NOM>`. Les files bull 3 sont vidées avant la bascule. **Validé (26/11/2026).** |
| D7 | Anomalies du §9 du document 06 | Corriger la sécurité, reproduire tout ce qui touche aux données et aux intégrations. **Validé (26/11/2026).** |
| D8 | Gestion des processus | systemd (un service par processus), journald pour les logs. **Validé (26/11/2026)** : pas de pm2 (ni fichier pm2 fourni). Montée en charge de l'API par instances `learninglocker-api@N` derrière nginx si besoin. |

## 4. Architecture cible sur la VM

```
nginx :80 (TLS plus tard)
 ├─ /                → /opt/learninglocker/web          (Angular 22, fichiers statiques)
 ├─ /dashboards/*    → /opt/learninglocker/web          (le token de partage est demandé à l'API)
 ├─ /api/*           → 127.0.0.1:8080  ll-api.service   (préfixe /api retiré, comme aujourd'hui)
 └─ /data/xAPI/*     → 127.0.0.1:8081  ll-xapi.service
ll-worker.service, ll-scheduler.service
MongoDB 8.0 (mongod.service, dépôt officiel, standalone)   127.0.0.1:27017
Redis 7 (paquet Ubuntu redis-server)                       127.0.0.1:6379
Docker : pile de référence « legacy » (lot 1), ports distincts, arrêtable
```

| Chemin | Contenu |
|---|---|
| `/opt/learninglocker/{api,worker,cli,web}` | Builds versionnés ; `current` est un lien symbolique vers la release active |
| `/opt/learninglocker/xapi` | Build d'xapi-service |
| `/etc/learninglocker/ll.env`, `/etc/learninglocker/xapi.env` | Configuration ; mêmes variables que les `.env` actuels |
| `/var/lib/learninglocker/storage` | Stockage fichiers commun (`FS_LOCAL_ENDPOINT` + `FS_SUBFOLDER` côté LL = `FS_LOCAL_STORAGE_DIR` côté xapi) |
| `/var/backups/learninglocker` | Dumps Mongo et archives du stockage |

Utilisateur système dédié `learninglocker`, sans shell. Pare-feu ufw : seuls 22 et 80/443 sont ouverts ; MongoDB et Redis écoutent sur localhost uniquement.

## 5. Lots de travail

Taille relative : S (quelques jours), M (1 à 2 semaines), L (plusieurs semaines), pour une personne aidée d’un agent de code (assistant IA).

### Lot 0 : socle de la VM (S)

- Mise à jour du système, extension du LV `/` (`lvextend -r -l +100%FREE`), ufw, durcissement SSH (clés uniquement).
- Node 24 LTS (NodeSource), corepack/npm ; MongoDB 8.0 (dépôt `repo.mongodb.org`, `noble`), mongosh, Database Tools ; `redis-server` ; nginx ; Docker Engine ; `build-essential`.
- Réglages : MongoDB et Redis liés à localhost ; Redis `maxmemory-policy noeviction` (indispensable pour BullMQ) ; ClamAV seulement si D2 le demande.
- **Livrable :** script idempotent `deploy/provision.sh` versionné dans le dépôt, rejouable sur une future VM de production.
- **Critère :** `mongosh --eval 'db.version()'` donne 8.0.x ; `redis-cli ping` ; nginx répond.

### Lot 1 : pile de référence « legacy » et données de référence (M)

Objectif : disposer de l'ancien système qui tourne, pour comparer chaque comportement du nouveau.

- `deploy/legacy/docker-compose.yml` : `mongo:4.2`, `redis:4`, Learning Locker `master` (image `node:10`, `yarn build-all`), xapi-service v7.1.2 (image `node:16`), nginx. Ports décalés (par exemple 18080) pour coexister avec la cible.
- Données de référence :
  - si D1 = production : dump anonymisé (scripts d'anonymisation des emails, noms, IFI) ;
  - sinon : génération avec `seed`, `bulkInsert` et la suite de conformité ADL, plus un scénario manuel couvrant chaque écran (organisations, rôles, clients, dashboards avec les 3 modèles, toutes les visualisations, partages ANY et JWT, forwarding, imports de personas).
- **Outil de capture « golden »** : un proxy enregistre les couples requête/réponse sur la pile legacy. Le même jeu de requêtes est ensuite rejoué sur la nouvelle pile, avec comparaison normalisée (dates, `_id`, `errorId`).
- **Script de vérification de base** `tools/verify-db` : collections, volumes, index (nom, clés, options), types de champs sensibles (`createdAt` chaîne/Date, champs JSON en chaîne), contenu de `migrations`. Il sert à l'inventaire, puis à chaque répétition de migration.
- **Critère :** la pile legacy tourne ; un jeu d'au moins quelques centaines de requêtes golden est enregistré.

### Lot 2 : xapi-service 2026 (M), dans le fork xapi-service

Lot traité en premier, car il est plus petit et valide d'emblée le chemin des données sur MongoDB 8.

- Internaliser `jscommons` (erreurs, `checkScopes`, presenters, config, logger, `handleListen`) avec **les mêmes formats JSON et messages**.
- TypeScript 6.0, Node 24, driver `mongodb` 7.x (dernière version au 26/11/2026 ; le retour de `findOneAndUpdate`/`findOneAndDelete` a changé depuis la 4.x : 26 appels concernés), ioredis 6, AWS SDK v3 à jour, express 4.21. Express 5 seulement après la validation complète.
- Supprimer les dépendances mortes (`redis`, `node-fetch`, `install`, `google-auth-library`, `patch-package` et le patch GCS) ; épingler `object-hash` 2.x et `mime-types` 2.1.35 (contrats de données).
- Arrêt propre (drainage, fermeture Mongo/Redis), route de santé, limite de taille des requêtes configurable, garde-fous contre `dropDatabase` hors base de test et `AUTH_REPO=test` en production.
- Tests : suite mocha sur Mongo 8 + Redis 7 ; suite ADL **épinglée** ; golden du lot 1 ; test de non-régression du `hash` sur un échantillon de statements réels.
- **Critère :** ADL et golden identiques à la v7.1.2 ; le worker legacy traite les statements émis par le nouveau service.

### Lot 3 : monorepo et outillage (S)

- Branche `v2026` : `packages/shared`, `apps/api`, `apps/worker`, `apps/cli`, `apps/web`, `deploy/`, `tools/`.
- TypeScript 6.0 strict (version imposée par Angular 22 et typescript-eslint ; TypeScript 7 plus tard), ESLint 10 (flat config), Vitest 5 pour les bibliothèques, supertest pour l'API, Playwright pour le front.
- CI GitHub Actions avec services `mongo:8.0` et `redis:7`. CircleCI est abandonné.

### Lot 4 : bibliothèque partagée `packages/shared` (M) — chemin critique

Contenu (cf. 06 §5.2) : construction des pipelines de visualisation, `periodToDate`, `update$dteTimezone`, `parseQuery` (côté serveur), modèle du query builder, mappers des champs sérialisés, calcul des scopes de rôle, validation des mots de passe et des IFI.

- **Tests différentiels** : les sorties de référence sont calculées par le vrai code legacy, dans son image d'origine (service presave : babel 6, Immutable 3.8, moment 2.24), puis enregistrées en fixtures compressées (`tools/oracle/`). Le nouveau code doit produire des sorties identiques. Entrées : toutes les visualisations des données de référence, plus des cas générés. (Plus fidèle qu'une transpilation esbuild de l'ancien code, et sans dépendances de 2021 dans la CI.)
- Les specs jest existantes sont portées comme oracles.
- **Critère :** 100 % d'identité sur les pipelines générés pour toutes les visualisations des données de référence.

### Lot 5 : API 2026 (L)

Dans l'ordre :

1. Socle NestJS : configuration lue avec **la même sémantique** que l'ancien code (noms, défauts, `boolean()`), connexion Mongoose (modèles avec `collection` explicite, `strict` tolérant pour les champs hérités), Redis, logs, santé, helmet, `trust proxy`.
2. Authentification : JWT identiques (claims, HS256, `APP_SECRET`, vérification par régénération du payload), cookies, refresh, Basic client, OAuth2 `client_credentials`, Google en OIDC.
3. Filtres de scope (portage de `lib/services/auth`, tests `modelFilters` portés).
4. Couche REST générique compatible express-restify-mongoose (`/v2/<modèle>` : `query`, `sort`, `skip`, `limit`, `select`, `populate`, `distinct`, POST/PUT/PATCH `/:id`) et pagination `/connection/<modèle>` (curseurs identiques).
5. Statements : `aggregate`, `aggregateAsync` (mêmes clés de cache Redis), `count`, `v1`, métadonnées, suppression par lots.
6. Personas réimplémentées sur `personas`, `personaIdentifiers` et `personaAttributes` (formats identiques), fusion, imports CSV, uploads (logo), exports CSV.
7. Nouveaux endpoints : émission du token de dashboard partagé (logique de `renderDashboard.js`) et configuration publique (`RESTRICT_CREATE_ORGANISATION`, `ENABLE_STATEMENT_DELETION`).
8. Corrections de sécurité validées en D7.

- **Critère :** suite supertest portée verte ; golden identiques, hors écarts listés et validés (corrections de sécurité).

### Lot 6 : worker, scheduler, CLI (M)

- BullMQ, mêmes noms de files (faute `REQEUST` comprise) ; écoute Redis `statement.new`/`statement.notify` ; orchestration et champs de suivi (`processingQueues`, `completedQueues`, `*ForwardingQueue`) inchangés.
- Handlers : personas, cache du query builder (même calcul de `hash`), forwarding (corrections : compteur de tentatives par destination, délai réel), suppression par lots, notifications d'expiration, statistiques d'usage (`$collStats`), imports de personas (limite de tentatives).
- Scheduler avec les mêmes verrous Redis.
- CLI : `createSiteAdmin`, `migrateMongo` (lit la collection `migrations` existante ; les migrations 2026 sont ajoutées **après** les 16 clés actuelles), `requeueStatements`, `batchJobs`, `clearAggregationCache`, `updateStatementCount`, `disableRegister`. Les commandes de migration v1 ne sont pas portées.
- **Première migration 2026** : création **idempotente** des index attendus (noms historiques conservés), plus les nouveaux index (`states`, `agentProfiles`, `activityProfiles`), après détection des doublons.
- **Critère :** un statement envoyé à xapi-service 2026 traverse les trois files avec les mêmes effets en base que sur la pile legacy.

### Lot 7 : front Angular 22 (L)

- Angular 22 (standalone, signals), Angular Material/CDK, ECharts, angular-gridster2. Mêmes URL que router5 (cf. [05-front.md §2](05-front.md)).
- Ordre de livraison, chaque étape utilisable seule :
  1. connexion, mot de passe oublié, choix d'organisation, gabarit (navigation latérale et supérieure) ;
  2. dashboards en lecture (grille, widgets, tous les types de visualisation) ;
  3. dashboards partagés et intégrés (`/dashboards/…`, filtres ANY/JWT) ;
  4. édition des visualisations et du query builder (basic et raw), modèles de visualisation ;
  5. édition des dashboards (grille, widgets, partage, modèles Getting Started et Stream) ;
  6. source (explorateur de statements) et exports ;
  7. personas (gestion, fusion, imports) ;
  8. réglages : stores, clients, utilisateurs, rôles, organisations, apps ;
  9. administration du site.
- Tests Playwright de bout en bout ; comparaison visuelle des graphiques avec la pile legacy sur les mêmes données.
- **Critère :** parité fonctionnelle validée écran par écran (check-list issue de 05-front.md).

### Lot 8 : exploitation (S)

- Unités systemd (`Restart=on-failure`, `TimeoutStopSec`, utilisateur dédié, durcissement `ProtectSystem`), vhost nginx (reprise de `nginx.conf.example` : `client_max_body_size 20M`, en-têtes), TLS via certbot dès qu'un nom de domaine existe.
- Sauvegardes quotidiennes : `mongodump` plus archive de `storage/`, rotation, **restauration testée**.
- Supervision minimale : routes de santé, alerte disque, journald.
- Procédure de déploiement : build sur CI ou en local, copie d'une release, bascule du lien `current`, `systemctl restart`, retour arrière en rebasculant le lien.

### Lot 9 : migration des données et bascule (M)

0. **Ordre imposé** : MongoDB doit être en 4.4 au moins avant de démarrer xapi-service 2026 (driver 7). Vérifier aussi que `MONGO_URL` n'utilise que `true`/`false` pour ses options booléennes.
0. **Préalable (D1)** : versions, volume, options activées et `inventory.json` de la base de production. Comparer cet inventaire à celui du jeu de test (`compare.mjs`) : toute collection, index ou type de champ absent du jeu de test est ajouté au seed ou à `legacy-quirks.js` avant la première répétition.
1. **Répétition à blanc** (au moins deux fois) : dump de la production (ou des données de référence) en 4.2, `mongorestore` vers MongoDB 8.0, `tools/verify-db` (volumes, index, types), migrations 2026, rejeu des golden, recette fonctionnelle.
2. Configuration : reprise des `.env` existants ; seuls les chemins changent. Contrôle automatique : la nouvelle pile démarre avec l'ancien `.env` sans erreur et signale les variables inconnues ou ignorées.
3. Bascule : gel des écritures (maintenance nginx sur l'ancienne instance), arrêt des workers après vidage des files, dernier dump et synchronisation du `storage/`, restauration, démarrage, contrôles, ouverture.
4. Retour arrière : l'ancienne instance reste intacte et arrêtée tant que la nouvelle n'est pas validée.

## 6. Ordre et jalons

```
Lot 0 ──► Lot 1 ──┬──► Lot 2 (xapi) ───────────────────────────┐
                  ├──► Lot 3 ──► Lot 4 (shared) ──┬──► Lot 5 (API) ──► Lot 6 (worker) ──┤
                  │                               └──► Lot 7 (Angular, à partir de l'étape 2 dès que l'API lecture existe)
                  └──► Lot 8 (en continu) ─────────────────────────────────────────────┴──► Lot 9
```

| Jalon | Contenu | Preuve |
|---|---|---|
| J1 | VM prête, pile legacy et données de référence | `provision.sh` rejouable ; golden enregistrés |
| J2 | xapi-service 2026 sur MongoDB 8 | ADL + golden xAPI identiques |
| J3 | Bibliothèque partagée validée | 100 % des pipelines identiques |
| J4 | API et worker 2026 | suite de contrat verte ; bout en bout xAPI → worker → API |
| J5 | Front Angular à parité | check-list des écrans + Playwright |
| J6 | Répétition de migration réussie | `verify-db` et golden sur données restaurées |
| J7 | Mise en production | bascule et période d'observation |

## 7. Stratégie de test

| Niveau | Outil | Ce qu'il protège |
|---|---|---|
| Différentiel | Vitest + ancien code transpilé | Pipelines, requêtes, formats sérialisés, scopes |
| Contrat API | supertest porté + golden rejoués sur les deux piles | Routes, codes, formats, tokens, erreurs |
| Conformité xAPI | Suite ADL épinglée | Clients xAPI existants |
| Données | `tools/verify-db` | Collections, index, types, migrations |
| Bout en bout | Playwright | Parcours utilisateur Angular |
| Exploitation | Restauration de sauvegarde, redémarrage forcé | Absence de perte (arrêt propre, files) |

**Règle de sécurité :** les tests ne tournent jamais sur la base de travail. Ils utilisent une base dédiée (`ll_test_*`), avec un garde-fou dans le code qui refuse `dropDatabase` sur tout autre nom.

## 8. Risques principaux et parades

| Risque | Parade |
|---|---|
| Pipelines Angular différents de ceux recalculés par le serveur (dashboards partagés refusés) | Bibliothèque unique partagée (lot 4), tests différentiels |
| Hash des statements modifié (409 à tort) | `object-hash` épinglé, test sur échantillon réel |
| Pièces jointes introuvables | Stockage commun unique, correspondance des variables, test de forwarding avec pièces jointes |
| Index existants en conflit ou manquants | Migration d'index idempotente, noms historiques, `verify-db` |
| Formes de données héritées (dates en chaîne, champs v1) | Schémas tolérants + inventaire du lot 1 |
| Sessions invalidées à la bascule | Même `APP_SECRET`, JWT identiques |
| Disque ou mémoire insuffisants sur la VM | Extension du LV (lot 0) ; pile legacy arrêtée hors des sessions de comparaison |
| Dérive du périmètre (fonctionnalités cloud) | D2 : Redis et stockage local d'abord, le reste sur demande |

## 9. Avancement

| Lot | État | Détail |
|---|---|---|
| 0 | **Fait** le 26/11/2026 | `deploy/provision.sh` exécuté trois fois sans erreur (idempotent), puis vérifié après redémarrage. Installé : Node 24.22.3 (npm 11.19.1, OpenSSL 3.5.9), MongoDB 8.0.38 (FCV 8.0, mongosh 2.14.3), Redis 7.0.15 (`noeviction`, `overcommit_memory=1`), nginx 1.24.0, Docker 29.10.1 (Compose 5.8.0). LV racine étendu à 62 Go. ufw : 22, 80, 443. MongoDB et Redis n'écoutent que sur localhost. Réglages THP et swappiness de MongoDB 8.0 appliqués au démarrage (`mongodb-thp.service`). Utilisateur système `learninglocker` et arborescence créés. |

Deux avertissements MongoDB restent ouverts :
- **Contrôle d'accès désactivé.** Acceptable tant que mongod n'écoute que sur localhost et ne contient pas de données réelles. À activer (utilisateurs dédiés à l'API, au worker et à xapi-service) **avant l'import de toute donnée réelle** (lot 1).
- **Système de fichiers ext4 au lieu de XFS.** Sans conséquence pour la VM de travail. Pour la production, prévoir un volume de données MongoDB en XFS.

Non fait volontairement : le durcissement SSH (option `--harden-ssh`), qui couperait l'accès par mot de passe. À lancer après avoir confirmé que toutes les connexions utilisent une clé.

| Lot | État | Détail |
|---|---|---|
| 1 | **Fait** le 26/11/2026 | Pile legacy en conteneurs (`deploy/legacy/`) : LL `master` (Node 10, image construite depuis les sources), xapi-service v7.1.2, MongoDB 4.2, Redis 4, nginx sur le port 18080, récepteur de forwarding `echo`. Jeu de test généré : `tools/seed/` (voir son README), la production sera migrée au lot 9 (D1). Instantané de référence `~/legacy/snapshots/20261126T1418Z` sur la VM. Capture golden : `tools/golden/` (voir son README), référence dans `snapshots/20261126T1418Z/golden/latest`. |

Jeu de test de référence (passe complète, graine 20261126) :
- **Volumes** : 15 487 statements (15 516 envoyés + 1 statement v1 hérité − 30 supprimés par lots), 71 personas, 73 identifiants, 107 attributs, 80 activités, 3 710 valeurs de cache du query builder, 30 visualisations, 6 dashboards, 7 clients, 5 utilisateurs, 3 organisations, 4 configurations de forwarding, 16 migrations ; 34 collections au total.
- **Traitement par le worker** : tous les statements ont leur persona, sauf les 5 groupes anonymes (pas d'identifiant) et le statement v1. 4 225 requêtes de forwarding ont été reçues, nouvelles tentatives comprises.
- **Fichiers** : `learninglocker_v2.archive.gz` (4,9 Mo), `storage.tar.gz` (2,1 Mo), `inventory.json`, `manifest.json` (identifiants et clés), `forwarded.ndjson`, `personas.csv`, `legacy-quirks.json`.
- **Test de restauration dans MongoDB 8.0.38** (VM) : `mongorestore` du dump 4.2 en 9 s, puis `tools/verify-db/compare.mjs` donne **aucun écart bloquant** (mêmes collections, volumes et index). Les seules différences de types relevées viennent de l'échantillonnage aléatoire de l'inventaire. Résultat conservé dans `inventory-restaure-mongo80.json`.

Constats faits en route :
- **Construction de l'image legacy** : le module natif grpc 1.9 (chargé même avec Redis comme file) impose `node:10-stretch` et une compilation depuis les sources (voir `deploy/legacy/ll.Dockerfile`).
- **Débit du worker** : il dépend surtout de MongoDB. Le rythme varie de 300 à 1 200 statements par minute ; MongoDB est à plus de 100 % de CPU, le worker attend. C'est le premier point de performance à mesurer sur la version 2026.
- **Écritures différées** : le worker continue d'alimenter le cache du query builder quelques minutes après le traitement des statements. L'instantané attend donc que la base soit stable, puis arrête les services applicatifs.
- **Accès en lecture refusé** : `GET /api/v2/batchdelete/:id` renvoie 403 avec le jeton d'organisation de l'admin, mais fonctionne avec la clé Basic du client. À corriger (D7).

Référence golden (`tools/golden`) :
- **745 requêtes** : 45 d'authentification, 127 sur les modèles REST et les connexions, 225 dans la matrice des droits (15 profils × 15 routes), 38 sur les statements et agrégations, 83 sur les visualisations (dont 51 agrégations des pipelines du front), 19 sur les dashboards partagés, 43 sur les personas, 5 téléchargements, 89 xAPI, 60 écritures d'administration. Statuts : 498 × 200, 15 × 201, 23 × 204, 26 × 400, 77 × 401, 65 × 403, 21 × 404, 2 × 409, 2 × 412, 14 × 500, 2 sans réponse.
- **Déterminisme vérifié** : deux enregistrements successifs, avec restauration de l'instantané entre les deux, sont identiques à 100 % après normalisation. Un enregistrement prend environ 2 minutes (plus 1 minute de restauration).
- **Pipelines du front** : `pipelines.json` contient, pour les 30 visualisations, les pipelines calculés par le code React à date figée. C'est la référence du lot 4 (bibliothèque partagée).
- **Anomalies legacy enregistrées telles quelles** :
  - toutes les routes `/v2/<modèle>/:id/shallow` restent sans réponse ;
  - erreurs 500 au lieu de 400 ou 404 : JSON invalide dans `filter` ou `pipeline`, curseur invalide, identifiant inconnu (métadonnées, logo), type de fichier refusé, import sans fichier ;
  - `/v2/stream` et `/v2/personasimporttemplate` renvoient toujours 500 ;
  - `$lookup` n'accepte que la forme `let`/`pipeline` (la forme `localField` donne 500) ;
  - le compteur de statements d'un store n'est pas mis à jour après une suppression par lots (15 516 au lieu de 15 487).

  Quand la version 2026 les corrige (D7), les cas concernés sont listés dans `golden/accepted.json`, passé à `diff.mjs --accept`.

| Lot | État | Détail |
|---|---|---|
| 3 | **Fait** le 26/11/2026 | Branche `v2026` en monorepo npm (workspaces `packages/*`, `apps/*`). Code d'origine déplacé tel quel dans `legacy/` (exclu du lint, du typage et des tests). TypeScript 6.0 strict, ESLint 10, Vitest 5, Node 24 (`.nvmrc`). CI GitHub Actions : lint, typage, build, tests, syntaxe des outils. Premier module de `packages/shared` : encodage `&46;` (`encodeDot`, `decodeDot`, `mapDot`), 8 tests. `AGENTS.md` : consignes neutres vis-à-vis des agents de code. |
| 4 | **Fait** le 27/11/2026 (jalon J3) | Code commun porté dans `packages/shared`, sans Immutable ni driver MongoDB, vérifié par oracle (vrai code legacy dans l'image legacy, `tools/oracle/`), identité 100 % :<br>• **Pipelines de visualisation** (`buildVisualisationPipelines`, `pipelinesFromQueries`, `reviveVisualisation`, `periodToDate`, `update$dteTimezone`) : 14 327 / 14 327 cas (chaîne JSON exacte, ordre des clés compris ; 507 cas où le front échoue, le portage aussi).<br>• **parseQuery** (`$oid`, `$dte`, `statement.timestamp`, `$out`, `$lookup`, `$personaIdent`) : 1 435 / 1 435 cas ; accès base injectés (`getScopeFilter`, `getPersonaAttributes`, fabrique d'ObjectId) ; sémantique du code legacy transpilé (Babel) reproduite.<br>• **Scopes** (dépendances, `generateNewScopes` du formulaire des rôles avec l'ordre du Set Immutable, scopes d'un jeton d'organisation, `canViewModel`, `canCreateOrganisations`) : 1 277 / 1 277 cas.<br>• **Sérialisation des schémas du front** (`preSave`/`revive` des 25 schémas) : 873 / 873 cas, documents réels de la base de test compris.<br>• **Validation** (règles et historique des mots de passe, IFI via rulr/xapi-validation, messages de l'API) : 571 / 571 cas.<br>• **Utilitaires du query builder** (`getCriteria`, `addTokenToQuery`, `deleteCriterion`, `queryToStringList`, `has$dte`) : 2 145 / 2 145 cas.<br>Specs legacy portées. Reste au lot : rien de ces briques ; le module Redux `queryBuilder.js` est au lot 7. |

Constats du lot 4 :
- **Bizarreries legacy reproduites** (identité exigée, car pendant une transition le front React et l'API 2026 doivent calculer les mêmes pipelines pour les dashboards partagés) : ordre des clés d'une Map Immutable de plus de 8 clés (ordre du hash), fuseau `+05:30` traité comme UTC pour `TODAY` et les `$dte`, fenêtre vide du benchmark `TODAY`, valeur par défaut `'statement'` de Correlation, etc. Liste dans les en-têtes des fichiers de `packages/shared/src/visualisations/`.
- **Données de fuseaux horaires** : le portage utilise des données récentes (tz 2026f, `moment-timezone` 0.6) ; le legacy, celles de 2019. Pour 48 fuseaux dont les règles ont changé (Mexico, Le Caire, Santiago, Téhéran…), les pipelines `TODAY`/`$dte` diffèrent du legacy : la nouvelle valeur est la bonne. Conséquence en transition : un dashboard partagé dans l'un de ces fuseaux, affiché par le front React, pourrait être refusé par l'API 2026.

Ajouts prévus avec les lots suivants : services `mongo:8.0` et `redis:7` dans la CI (lot 5), supertest (lot 5), Playwright (lot 7). Les dossiers `apps/*` sont créés au début de chaque lot.

| Lot | État | Détail |
|---|---|---|
| 2 | **Fait** le 26/11/2026 (jalon J2) | Fork xapi-service, branche `v2026`, en 5 étapes, chacune validée par la suite mocha sur MongoDB 8.0 et Redis 7 jetables (`scripts/test-in-docker.sh`). A : `jscommons` intégré dans `src/commons/`. B : S3, Azure, Google, SQS, New Relic et CloudWatch retirés (D2) ; le démarrage échoue avec un message clair s'ils sont configurés. C : Node 24, TypeScript 6.0, npm, ESLint 10, Dockerfile multi-étapes non-root. D : mongodb 7.9, ioredis 6, express 4.22, winston 3, etc. ; `npm audit` à 0. E : arrêt propre, `GET /health`, garde-fous (`dropDatabase` et `AUTH_REPO=test` réservés aux bases `ll_test*`). Tests : 1 572 → 1 589 (17 nouveaux), 0 échec. |

Résultats de validation du lot 2 :
- **Conformité ADL** (xAPI 1.0.3, suite épinglée au commit `5bc232d`) : 1 365/1 365 pour la v7.1.2 comme pour la version 2026 (`scripts/conformance-in-docker.sh` du fork).
- **Golden** : avec xapi-service 2026 à la place de la v7.1.2 dans la pile legacy, les 745 cas sont identiques à la référence (dont les 89 cas xAPI). Le worker legacy traite normalement les statements écrits par le nouveau service (personas, cache du query builder, forwarding, voiding).
- **Réponses HTTP** : statuts, en-têtes (dont les en-têtes de sécurité de helmet 3, reproduits à la main) et corps identiques à la v7.1.2.
- **Écart accepté (D7)** : dans la syntaxe de requête alternative, une séquence `%` invalide est décodée en `\uFFFD` (query-string 10, correctif de sécurité).

Constats importants pour la suite :
- **Le driver MongoDB 7 exige MongoDB ≥ 4.4.** xapi-service 2026 ne peut pas tourner sur une base en 4.2 : la base doit être migrée avant ou en même temps que le service (lot 9). La pile legacy accepte MongoDB 4.4 sans écart (golden identique à 100 %) : `LEGACY_MONGO=4.4`.
- **Options booléennes de `MONGO_URL`** : le driver 6+ n'accepte que `true`/`false` (pas `1`/`0`). À vérifier sur la configuration de production (lot 9).
- **Limite de fichiers ouverts** : MongoDB en conteneur doit avoir `nofile` à 64 000 (sinon `WT_PANIC` sous charge). Le paquet officiel sous systemd le fait déjà.
- **`EXPRESS_BODY_PARSER_LIMIT` n'est appliquée nulle part** par xapi-service : la taille des requêtes doit être limitée par nginx (`client_max_body_size`).
- **Perte possible à l'arrêt brutal** (SIGKILL, OOM) : les statements insérés peuvent ne jamais être notifiés au worker. Piste : une « outbox » MongoDB rejouée au démarrage (à décider).
- **CI du fork xapi-service** : les GitHub Actions sont désactivées par défaut sur un fork ; à activer dans l'onglet Actions du dépôt.


## 10. Prochaines actions

1. Toi : décisions D1 à D8 toutes tranchées le 26/11/2026. En option : la redirection de port vers la VM (§2) pour ouvrir l'interface legacy dans ton navigateur, et un instantané de la VM dans Boxes maintenant que la référence est produite.
2. Moi : lot 5 (API 2026), validé par la référence golden.
3. Ensuite : lot 4 (bibliothèque partagée, validée contre `pipelines.json`), puis lots 5 et 6.
