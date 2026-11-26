# 06. Analyse préparatoire : Learning Locker « 2026 »

> [Index de la documentation](README.md) · Rédigé le 26 novembre 2026. Les versions cibles sont celles disponibles à cette date.

## 1. Objectifs

1. **Compatibilité 100 %** avec les données existantes (base MongoDB, Redis, fichiers stockés) et avec la configuration existante (`.env`).
2. **Nouveau front** dans une autre technologie, de type Angular.
3. **Socle à jour** : Node.js LTS, MongoDB dernière version, dépendances maintenues.
4. **Déploiement** sur une VM Ubuntu Server LTS.

## 2. Constat

- **Presque toute la pile doit changer.** Node 10, babel 6, webpack 3, node-sass, Mongoose 5, express-restify-mongoose 3, persona-service (driver Mongo 2.2), bull 3, aws-sdk v2, winston 2, nodemailer 2 : aucun de ces éléments ne fonctionne, ou n'est supporté, avec Node 24/26 et MongoDB 8/9. Une « simple montée de version » toucherait la quasi-totalité des fichiers.
- **Le contrat avec l'existant est riche et parfois implicite.** Noms de collections singuliers, champs JSON stockés en chaînes, opérateurs maison (`$oid`, `$dte`, `$personaIdent`), algorithmes de hachage, structure exacte des JWT, noms de files avec faute de frappe. Il est documenté dans les fichiers 02 à 05 et résumé au §4.
- **Le front porte de la logique métier critique.** La construction des pipelines d'agrégation des visualisations se fait côté client, et le serveur réutilise ce même code pour autoriser les dashboards partagés. C'est le principal risque de régression ([05-front.md §6](05-front.md)).
- **xapi-service est hors de ce dépôt mais dans le périmètre.** Il écrit dans la même base, avec un driver Mongo 3.4 ancien. Sans mise à jour, il bloque l'objectif « MongoDB dernière version ».

## 3. Versions cibles (novembre 2026)

| Composant | Actuel | Cible recommandée | Remarque |
|---|---|---|---|
| Node.js | 10 | **Node 24 LTS** (support jusqu'en avril 2028) ou **Node 26 LTS** (LTS depuis fin octobre 2026, support jusqu'en avril 2029) | Node 26 pour la durée de vie. Rester sur 24 si une dépendance n'est pas encore validée sur 26. À partir de Node 27, une seule version majeure par an, toutes LTS. |
| MongoDB | 4.2 | **MongoDB 9.0** (septembre 2026) sur Ubuntu 26.04, ou **8.0** sur Ubuntu 24.04 | Voir §6 : la compatibilité OS/version est le point délicat. |
| Driver / ODM | Mongoose 5.8 + driver 2.2 et 3.3 | Mongoose (dernière majeure) sur le driver `mongodb` officiel courant | Un seul driver, un seul pool. Supprimer persona-service. |
| Redis | 4 | Redis 7+ ou Valkey 8 (protocole compatible) | Selon le paquet fourni par la version d'Ubuntu. |
| Files | bull 3 | BullMQ (ou bull 4) | Les clés Redis changent avec BullMQ : vider les files avant la bascule. |
| Langage | JavaScript + babel 6 | **TypeScript**, ESM, exécuté directement par Node (build `tsc` ou esbuild) | Plus de webpack côté serveur. |
| Backend HTTP | Express 4 + express-restify-mongoose | **NestJS** (adaptateur Express 5) ou Express 5 + TypeScript | NestJS a la même organisation (modules, DI, décorateurs) qu'Angular. |
| Front | React 16 + Redux | **Angular 22** (juin 2026, support actif jusqu'en juin 2027 ; Angular passe à un cycle annuel) | Composants standalone, signals, Angular Material/CDK, ECharts, angular-gridster2. |
| Process | pm2 | systemd (une unité par processus) ou pm2 récent | systemd est natif sur Ubuntu et simplifie la supervision. |
| OS | non précisé | **Ubuntu Server 24.04 LTS** ou **26.04 LTS** | Voir §6. |

## 4. Contrats de compatibilité à préserver

Cette liste sert de checklist de recette. Chaque point renvoie à la documentation détaillée.

### 4.1 Données MongoDB ([02-donnees.md](02-donnees.md))

- [ ] **Noms exacts des collections**, y compris singuliers et casses : `client`, `role`, `lrs`, `batchDelete`, `statementForwarding`, `importcsv`, `queryBuilderCaches`, `oAuthTokens`, `personaIdentifiers`, `audits`…
- [ ] **Noms et options exacts des index** (§4.4). Un index de mêmes clés sous un autre nom provoque `IndexOptionsConflict`. Ne plus compter sur l'`autoIndex` au démarrage : créer les index par migration explicite.
- [ ] **Champs JSON stockés en chaînes** : `client.authority`, `visualisations.filters[]` et `axes*`, `dashboards.shareable[].filter`, `users.organisationSettings[].filter`, `statementForwarding.query` et `configuration.headers`, `queries.conditions`, `exports.projections[]` (ordre des clés significatif), `batchDelete.filter`.
- [ ] **Opérateurs maison** dans ces requêtes : `$oid`, `$dte` (avec réécriture d'offset au changement de fuseau), `$personaIdent`, `$comment` contenant `{criterionLabel, criteriaPath}`.
- [ ] **Encodage `&46;`** des points dans les clés d'extensions (`statements`, `fullActivities`, `metadata`, `queryBuilderCaches`).
- [ ] **Hachages et secrets** : bcrypt `$2a$`, coût 8, pour `password` et `passwordHistory` ; `resetTokens.token` = bcrypt de l'email, comparé par égalité ; clé et secret client en 40 caractères hexadécimaux comparés **en clair** (contrat avec xapi-service) ; hash de `queryBuilderCacheValues` (sha1 au-delà de 40 caractères).
- [ ] **Identifiants fixes** : `siteSettings._id = 111111111111111111111111` ; `_id` des `dashboards.shareable[]`, présents dans les URL de partage publiées.
- [ ] **Collection `migrations`** : conserver les 16 clés existantes et leur ordre ; ajouter les migrations 2026 à la suite.
- [ ] **Formes héritées à tolérer** : `createdAt`/`updatedAt` en chaîne ISO (commande v1 `migrateTimestamps`), champs `old*` et `hasBeenMigrated`, `statements.refs`, `client_id`, `lrs`, ancienne collection `personaidentifiers`.
- [ ] **Sémantique des horodatages** : `mongoose-timestamp` ne mettait pas à jour `updatedAt` sur `updateOne`/`updateMany`. Décider si on garde ce comportement.

### 4.2 Configuration ([04-worker-cli-config.md §5](04-worker-cli-config.md))

- [ ] **Mêmes noms de variables**, mêmes valeurs par défaut et même interprétation (`boolean()` sur les chaînes, repli sur la valeur par défaut si `Number()` donne NaN).
- [ ] Inclure les variables **non documentées** dans `.env.example` mais lues par le code : `EVENTS_REPO`, `REDIS_PASSWORD`, `SENTINEL_*`, `FS_RACK_*`, `PORT`, `RUNTIME_NODE_ENV`, ainsi que les variables `MONGO_*` lues par persona-service.
- [ ] `APP_SECRET` inchangé, sinon les sessions en cours sont invalidées (sans perte de données).
- [ ] Variables aujourd'hui figées au build (`COOKIE_DOMAIN`, `NODE_ENV`) : les lire à l'exécution dans la nouvelle version.
- [ ] Variables devenues sans objet (`ENABLE_REACT_DEVTOOLS`, `NEW_RELIC_*` selon le choix d'observabilité) : les accepter et les ignorer avec un avertissement, pour qu'un `.env` existant démarre tel quel.

### 4.3 API et sécurité ([03-api-auth.md](03-api-auth.md))

- [ ] **Clients API existants** : authentification Basic `basic_key:basic_secret`, scopes, routes `/api/statements/aggregate`, `/api/connection/*`, `/api/v2/*`, `/api/v1/statements/aggregate`, `/api/oauth2/token`. Des intégrations tierces peuvent appeler ces routes : leur format de requête et de réponse ne doit pas changer.
- [ ] **Format des JWT** (claims, `tokenType`, HS256, `APP_SECRET`) et **noms de cookies** (`access_token_<type>_<id>`, `refresh_token_<type>_<id>`, chemin `/api/auth/jwt/refresh`).
- [ ] **URL des dashboards partagés** déjà diffusées ou intégrées en iframe : `/dashboards/:dashboardId/:shareableId/<titre>?filter=…`, avec la même gestion de `visibility`, `validDomains` et `filterMode` (dont le filtre signé avec `filterJwtSecret`).
- [ ] **Liens stockés en base** : `organisations.logoPath = /api/downloadlogo/<orgId>` et `downloads.url = /api/organisation/<org>/downloadexport/<id>.csv`.

### 4.4 Inter-services : xapi-service, Redis, files, fichiers ([04-worker-cli-config.md §8](04-worker-cli-config.md))

- [ ] Collections lues ou écrites par xapi-service : `client` (`authority` en chaîne JSON), `organisations.expiration`, `lrs.statementCount`, `oAuthTokens`, `statements`, `fullActivities`.
- [ ] Protocole Redis d'arrivée des statements : liste `{REDIS_PREFIX}:statement.new` et canal `{REDIS_PREFIX}:statement.notify`, éléments `{"statementId":"<uuid>"}` ([02-donnees.md §2.3](02-donnees.md)). `REDIS_PREFIX` identique et non vide des deux côtés. Option `ENABLE_QUEUE_PRIORITY` et mode `EVENTS_REPO=sqs` d'xapi-service non gérés par le worker actuel.
- [ ] Variables de stockage d'xapi-service (`STORAGE_REPO`, `FS_LOCAL_STORAGE_DIR`, `FS_S3_*`, `SUB_FOLDER_*`) alignées sur les `FS_*` de Learning Locker, pour que le worker retrouve les pièces jointes. Tableau de correspondance : `learninglocker-xapi-service/docs/02-donnees-config.md` §3.2.
- [ ] Clés de stockage existantes conservées à l'octet près, `/` initial compris (`/statements/…` en S3).
- [ ] Noms de files `${QUEUE_NAMESPACE}_<NOM>`, y compris `STATEMENT_FORWARDING_REQEUST_QUEUE` (faute d'origine), et noms logiques stockés dans `statements.completedQueues` et `processingQueues`.
- [ ] Clés Redis de cache et de verrous (`*-AGGREGATION-*`, `*_SCHEDULER:RUNNING`).
- [ ] Arborescence de stockage : `{FS_LOCAL_ENDPOINT}/{FS_SUBFOLDER}/logos|downloads|personasCsvs|statements/{lrs_id}/attachments`.

## 5. Choix structurants (recommandations)

### 5.1 Backend : réécriture TypeScript à contrat figé, plutôt que montée de version sur place

**Recommandation : réécrire le backend en TypeScript, en figeant d'abord le contrat par des tests boîte noire.**

- Sur place, il faudrait remplacer le build, Mongoose (ruptures 6, 7 et 8 : callbacks, `remove`, `ObjectId` sans `new`, `count`, options de connexion), express-restify-mongoose, persona-service, toutes les bibliothèques de files et de stockage, passport et winston. Le gain de « garder le code » est faible.
- Le contrat est bien délimité et déjà en partie testé : environ 238 tests supertest dans `api/src/routes/tests`, 49 fichiers de tests dans `lib`, 42 specs jest côté front. Ces tests deviennent la suite de non-régression du nouveau backend, après remplacement des fabriques de tokens par des appels HTTP.
- Remplacer express-restify-mongoose par des contrôleurs explicites, qui reproduisent ses paramètres (`query`, `sort`, `skip`, `limit`, `select`, `populate`, `distinct`) et son comportement (mise à jour par `POST`, `PUT` ou `PATCH` sur `/:id`).
- Réimplémenter le service personas directement sur les collections `personas`, `personaIdentifiers` et `personaAttributes`, à format identique.
- **Porter à l'identique** la logique sensible : `parseQuery`, filtres de scope (`lib/services/auth`), `update$dteTimezone`, hachage des caches, orchestration du worker. Vérifier par des **tests différentiels** : même entrée passée à l'ancien et au nouveau code, sorties comparées.

### 5.2 Bibliothèque partagée pour la logique des requêtes

Extraire dans un **paquet TypeScript commun** (monorepo npm workspaces ou Nx), sans dépendance à React, Angular ou Immutable :
- construction des pipelines (`ui/src/utils/visualisations/**`, `ui/src/utils/dates.js`) ;
- `update$dteTimezone`, `lib/helpers/visualisation.js` ;
- modèle du query builder (`ui/src/redux/modules/queryBuilder.js`, `ui/src/utils/queries`) ;
- mappers des champs sérialisés (`ui/src/utils/schemas.js`, `preSave`/`reviver`) ;
- calcul des scopes de rôles (`lib/helpers/scopes.js`).

Ce paquet est utilisé par le backend (autorisation des dashboards partagés) et par le front Angular. Il garantit que les pipelines restent identiques des deux côtés. Les specs jest existantes (`grouper/index.spec.js`, `visualise.spec.js`, `RoleForm.spec.js`, `dates`, `schemas`) servent d'oracles.

### 5.3 Front Angular

- SPA statique servie par nginx. Le serveur UI Node disparaît.
- Ses responsabilités serveur passent dans l'API : émission du token de dashboard partagé (contrôles `visibility`, Referer et `validDomains`, en-têtes `X-Frame-Options`/CSP), et exposition de `RESTRICT_CREATE_ORGANISATION` et `ENABLE_STATEMENT_DELETION` (aujourd'hui injectés dans la page).
- Conserver **les mêmes URL** que router5 : `/login`, `/home`, `/organisation/:id/data/dashboards/:id`, `/dashboards/:id/:shareableId/…`, etc. Des favoris et des iframes y pointent.
- Garder les cookies `access_token_*` lisibles en JS, ou passer les téléchargements (logo, CSV) en requêtes authentifiées par Bearer avec réponse en blob.
- Appeler l'API en **même origine** (`/api`), y compris en développement via le proxy du serveur de dev Angular : le cookie de refresh est `SameSite=Strict` et limité au chemin `/api/auth/jwt/refresh`.
- Correspondances techniques proposées (store, graphiques, grille, formulaires) : [05-front.md §8](05-front.md).

### 5.4 xapi-service

Trois options :

| Option | Effort | Risque |
|---|---|---|
| A. Garder la version actuelle | nul | **Bloque MongoDB récent** : driver 3.4, Node ancien. Non compatible avec les objectifs. |
| B. **Forker et mettre à jour** xapi-service (Node LTS, driver Mongo courant) en gardant son contrat | moyen | Faible si on valide avec la suite de conformité LRS de l'ADL. **Recommandé pour la phase 1.** |
| C. Réintégrer l'endpoint xAPI dans le nouveau backend | élevé | Conformité xAPI 1.0.3 complète à reproduire (statements, voiding, attachments multipart, state, profils, `X-Experience-API-Version`…). À envisager plus tard. |

**Dépôt :** <https://github.com/LearningLocker/xapi-service>, licence MIT, non archivé. État relevé le 26/11/2026 :
- dernière release **v7.1.2** (24 mars 2023), dernier commit de code sur `master` en août 2023 ;
- Node 16, TypeScript 4.3, Express 4, driver `mongodb` ^4.10 (officiellement supporté jusqu'à MongoDB 6.0 environ), ioredis 4, `@aws-sdk/client-s3` v3 ;
- `.env.example` : `MONGO_URL` d'exemple avec `replicaSet=rs0` (à vérifier : un replica set est-il requis ?), `REDIS_PREFIX`, `EVENTS_REPO` (`redis` ou `sqs`), `QUEUE_NAMESPACE`, `ENABLE_QUEUE_PRIORITY`.

**Fork :** `profenpoche/learninglocker-xapi-service`, documenté dans son dossier `docs/`.

Partir du tag qui correspond à la version déployée, ou de `v7.1.2` à défaut. La montée de version est plus légère que pour ce dépôt : driver Mongo et SDK AWS sont déjà dans des versions modernes.

Information à collecter : la version d'xapi-service effectivement déployée (tag Git ou image Docker) et sa configuration.

### 5.5 Fonctionnalités cloud optionnelles

SQS, Google Pub/Sub, Azure Service Bus, stockages S3, GCS, Azure et Rackspace, CloudWatch, New Relic : chacun demande une réécriture sur un SDK récent. Pour un déploiement sur une VM unique, **Redis et le stockage local suffisent**. Proposition : livrer d'abord `QUEUE_PROVIDER=REDIS` et `FS_REPO=local` (plus S3 si utilisé), et refuser explicitement au démarrage les autres valeurs avec un message clair, jusqu'à ce qu'elles soient portées.

## 6. MongoDB : montée de version des données et choix de l'OS

### 6.1 Couple OS / MongoDB

| Ubuntu | MongoDB | Statut |
|---|---|---|
| **24.04 LTS** | **8.0** | Combinaison documentée officiellement. Choix le plus sûr. |
| **26.04 LTS** | **9.0** | Le support d'Ubuntu 26.04 est annoncé dans les notes de version de MongoDB 9.0. |
| 26.04 LTS | 8.0 | **À éviter** : plantages signalés (SERVER-131152, classé « Won't Do »), et problèmes connus avec les noyaux Linux ≥ 6.19. |

Avant d'installer, vérifier la page officielle des plateformes supportées pour la version visée.

### 6.2 Passage des données de 4.2 à 8.0 ou 9.0

- **Option 1, mise à niveau en place** : 4.2 → 4.4 → 5.0 → 6.0 → 7.0 → 8.0 (→ 9.0), en positionnant `setFeatureCompatibilityVersion` à chaque étape. C'est long, mais les index et les métadonnées sont conservés tels quels.
- **Option 2, recommandée pour une nouvelle VM : `mongodump` depuis la 4.2, puis `mongorestore` vers la nouvelle version** avec les MongoDB Database Tools récents. Ensuite :
  - comparer, collection par collection, le nombre de documents et la liste des index (nom, clés, options `unique`, TTL `expireAfterSeconds`) avec la source ;
  - créer les index manquants : les migrations historiques n'attendaient pas la fin de leurs `createIndex`, certains peuvent ne jamais avoir été créés ;
  - l'option `background:true` des anciens index est ignorée, c'est sans conséquence.
- Points d'attention MongoDB récents :
  - le `$lookup` avec `localField`/`foreignField` **et** `pipeline` (ajouté par `filter$lookup`) demande MongoDB 5.0 ou plus, ce qui est favorable ;
  - `collStats` est déprécié : passer à l'étape `$collStats` ;
  - le flag `g` dans `$options` d'une regex est invalide (migration 20200228 déjà jouée, à ne pas rejouer).

## 7. Déploiement sur Ubuntu Server

Architecture cible sur une VM :

```
nginx (TLS via certbot)
 ├─ /            → front Angular (fichiers statiques)
 ├─ /dashboards/ → front Angular (le token de partage est demandé à l'API)
 ├─ /api/        → backend 2026 (systemd : ll-api)
 └─ /data/xAPI/  → xapi-service mis à jour (systemd : ll-xapi)
systemd : ll-worker, ll-scheduler
MongoDB 8.0 / 9.0 (dépôt officiel MongoDB), Redis/Valkey (paquet Ubuntu)
ClamAV (clamav-daemon), si des uploads doivent être scannés
```

Points concrets :
- **Node.js** : depuis les binaires officiels ou NodeSource, version épinglée. Pas de compilation de modules natifs en production si possible : supprimer `.yarnrc` `build_from_source`.
- **Fuseau du serveur** : UTC par défaut sur Ubuntu. Le scheduler lance la tâche d'usage à 3 h **heure locale** ; garder UTC ou rendre l'heure configurable.
- **Mémoire** : les limites pm2 `--max-old-space-size=256` sont trop basses pour Node et Mongoose récents. Dimensionner à partir de mesures.
- **nginx** : reprendre `client_max_body_size 20M` et `large_client_header_buffers 4 256k` ; ajouter TLS. Configurer `trust proxy` côté API pour que le cookie de refresh soit `Secure`.
- **Sauvegardes** : `mongodump` planifié et sauvegarde du dossier `storage/`. Redis ne contient que du cache et des files.
- **Répertoire de travail** : supprimer les dépendances au `cwd` (`.env`, templates, `storage/tmp`, `git` pour `/api/app/version`) en passant par des chemins configurables et une version injectée au build.

## 8. Plan par phases

| Phase | Contenu | Livrable / critère de sortie |
|---|---|---|
| **0. Inventaire de l'instance existante** | Exporter la liste des collections avec leurs volumes et leurs index (`db.getCollectionInfos()`, `getIndexes()`), le contenu de `migrations`, le `.env` réel ; repérer les formes de données héritées (types de `createdAt`, `personaidentifiers`…) ; identifier la version d'xapi-service ; observer le protocole Redis (`redis-cli MONITOR`) ; lister les fonctionnalités réellement utilisées (forwarding, dashboards partagés en JWT, Google, SQS, S3…). | Rapport d'inventaire ; périmètre fonctionnel validé. |
| **1. Banc de tests de contrat** | Faire tourner l'ancienne version sur une copie des données (Docker : Node 10, Mongo 4.2, Redis 4). Adapter les tests supertest en boîte noire. Enregistrer des réponses de référence (« golden files ») pour les routes clés et les pipelines générés. | Suite rejouable contre n'importe quelle implémentation. |
| **2. Bibliothèque partagée** | Porter en TypeScript la logique de requêtes et de pipelines (§5.2). Tests différentiels contre l'ancien code. | 100 % des oracles verts. |
| **3. Backend 2026** | API, worker, scheduler et CLI en TypeScript sur Node LTS, Mongoose et driver récents. Personas réintégrées. Files Redis. Migrations 2026 ajoutées après les 16 existantes. | Suite de contrat verte sur MongoDB 8/9. |
| **4. xapi-service** | Fork et mise à jour (§5.4). | Suite de conformité ADL verte ; protocole Redis validé avec le worker 2026. |
| **5. Front Angular** | Écrans dans l'ordre d'usage : login et organisation, dashboards et visualisations (lecture puis édition), source et exports, personas, réglages, administration, dashboards partagés. | Parité fonctionnelle selon [05-front.md §2](05-front.md). |
| **6. Migration des données et recette** | Dump/restore vers la nouvelle VM, vérification des index et des volumes, migrations 2026, recette fonctionnelle sur copie de production. | Procédure de bascule répétée au moins une fois à blanc. |
| **7. Bascule** | Gel des écritures, dernier dump, restauration, changement DNS ou proxy, surveillance. Garder l'ancienne VM arrêtée mais intacte pour un retour arrière. | Mise en production. |

## 9. Anomalies existantes : reproduire ou corriger ?

« 100 % compatible » s'applique aux données et à la configuration. Pour les comportements, il faut trancher au cas par cas. Recommandation : **corriger** les failles de sécurité, **reproduire** ce dont dépendent les données ou les intégrations.

| Anomalie | Où | Proposition |
|---|---|---|
| Le reset de mot de passe renvoie le document utilisateur complet, hash compris | `AuthController.js:122` | Corriger |
| `/v2/sitesettings` lisible et modifiable par tout principal authentifié | `getScopeFilter.js:57` | Corriger (site admin seulement) |
| `filterJwtSecret` renvoyé aux porteurs d'un token de dashboard | `GET /v2/dashboard` | Corriger (champ jamais renvoyé publiquement) |
| `DELETE /v2/personaattribute?query=…` supprime en masse | `HttpRoutes.js:390` | Corriger, ou réserver aux scopes de gestion |
| Les pipelines utilisateur peuvent contenir `$graphLookup`, `$unionWith`, `$merge`, `$function` | `parseQuery` | Corriger : liste blanche d'étapes |
| Scope Google+ (`plus.login`) arrêté par Google ; `GOOGLE_ENABLED="false"` traité comme vrai | `lib/constants/auth.js:21`, `HttpRoutes.js:141` | Corriger (OpenID Connect `profile email`) |
| CORS `*`, pas de `trust proxy`, pas de helmet sur l'API | `api/src/server.js` | Corriger |
| Pas de logout serveur : les refresh tokens restent valides 7 jours | auth | Corriger (endpoint de logout qui efface le cookie) |
| Secrets en clair (client API, forwarding, `filterJwtSecret`) | modèles | **Reproduire pour l'instant** : xapi-service compare le secret client en clair. Hachage possible plus tard. |
| Tentatives de forwarding comptées toutes destinations confondues ; délai de retry ignoré sous Redis | worker | Corriger (comportement interne, sans impact sur les données) |
| Import de personas : nouvelle tentative sans limite | worker | Corriger |
| Pagination `connection` : `last` ignoré | `addCRUDFunctions` | Corriger en gardant le format des curseurs |
| Routes `/v2/stream` et `/v2/personasimporttemplate` toujours en erreur 500 | API | Ne pas reproduire |
| Code mort (journeys, Jisc, `AccessToken`, `RefreshToken`, `softDelete`, `uploadPeople`, `restify`, `multer`…) | divers | Ne pas porter |

Liste complète des anomalies : [02-donnees.md §8](02-donnees.md), [03-api-auth.md §7](03-api-auth.md), [04-worker-cli-config.md](04-worker-cli-config.md) (bugs signalés par section), [05-front.md §7](05-front.md).

## 10. Questions ouvertes

1. Existe-t-il une instance en production, avec quel volume de statements ? Quelle version d'xapi-service tourne avec ?
2. Quelles fonctionnalités optionnelles sont réellement utilisées : SQS, Pub/Sub, Service Bus, S3, GCS, Azure, Google OAuth, New Relic, CloudWatch, ClamAV ?
3. Des intégrations tierces appellent-elles l'API (`/api/statements/aggregate`, `/api/connection/*`, `/api/v2/*`) ou intègrent-elles des dashboards partagés en iframe ?
4. Backend : réécriture TypeScript (NestJS) comme recommandé, ou montée de version incrémentale du code actuel ?
5. xapi-service : fork et mise à jour (recommandé) ou réintégration ?
6. Ubuntu 24.04 + MongoDB 8.0, ou Ubuntu 26.04 + MongoDB 9.0 ?
7. Pour chaque anomalie du §9 : valider la proposition.

## Sources des versions

- [Node.js : évolution du calendrier de versions](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule), [dépôt nodejs/Release](https://github.com/nodejs/Release)
- [MongoDB : nouveautés produit (9.0, 8.3)](https://www.mongodb.com/products/updates/), [notes de version 9.0](https://www.mongodb.com/docs/manual/release-notes/9.0.md), [installation 8.0 sur Ubuntu](https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-ubuntu/), [SERVER-131152](https://jira.mongodb.org/browse/SERVER-131152)
- [Angular sur endoflife.date](https://endoflife.date/angular), [Angular v22 (InfoQ)](https://infoq.com/news/2026/08/angular-v22-released)
