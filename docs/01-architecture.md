# 01. Architecture générale

> [Index de la documentation](README.md) · État du code : commit `5fec948a` (novembre 2021).

## 1. Ce qu'est Learning Locker

Learning Locker est un **LRS** (Learning Record Store) open source, sous licence GPL-3.0, édité par Learning Pool. Il implémente la spécification **xAPI** (Experience API / Tin Can), stocke les traces d'apprentissage (« statements ») et fournit une interface d'analyse : dashboards, visualisations, gestion des personnes (personas), redirection des statements vers d'autres systèmes.

Ce dépôt contient la **v2** de Learning Locker (Node.js). Le dernier commit date du 16 novembre 2021 ; le projet n'a pas évolué depuis. L'historique Git remonte à janvier 2014 (v1 en PHP/Laravel), d'où les commandes de migration « v1 » encore présentes.

**Important : l'endpoint xAPI (`/data/xAPI/*`) n'est pas dans ce dépôt.** Il est servi par un service séparé, **xapi-service** (dépôt `LearningLocker/xapi-service`, TypeScript), qui partage la même base MongoDB et le même Redis.

## 2. Processus et services

```
                         ┌──────────────────────────── nginx (:80) ─────────────────────────────┐
  Navigateur ──────────► │ /            → fichiers statiques ui/dist/public, sinon UI server   │
  Outils xAPI (LMS…) ──► │ /data/xAPI/* → xapi-service (XAPI_PORT, projet séparé)              │
  Clients API ─────────► │ /api/*       → API (API_PORT, préfixe /api retiré)                   │
                         └──────────────────────────────────────────────────────────────────────┘
                                 │                    │                         │
                       ┌─────────▼────────┐  ┌────────▼────────┐     ┌──────────▼─────────┐
                       │ UI server :3000  │  │ API :8080       │     │ xapi-service       │
                       │ ui/dist/server   │  │ api/dist/server │     │ (externe)          │
                       │ coquille HTML,   │  │ Express 4       │     │ écrit statements,  │
                       │ proxy /api,      │  │ REST, auth JWT, │     │ fullActivities,    │
                       │ dashboards       │  │ agrégations     │     │ lrs.statementCount │
                       │ partagés (JWT)   │  └───┬────────┬────┘     └───┬─────────┬──────┘
                       └────────┬─────────┘      │        │              │         │ RPUSH + PUBLISH
                                │ lecture        │        │              │         ▼ statement.new/notify
                                ▼                ▼        ▼              ▼   ┌───────────┐
                         ┌──────────────────────────┐  ┌──────────────────┐  │  Redis    │
                         │ MongoDB (une seule base) │◄─┤ Worker           │◄─┤ cache,    │
                         │ MONGODB_PATH             │  │ worker/dist      │  │ queues    │
                         └──────────────────────────┘  │ personas, cache  │  │ bull,     │
                                ▲                      │ query builder,   │  │ verrous   │
                                │                      │ forwarding, etc. │  └───────────┘
                         ┌──────┴─────────┐            └──────────────────┘        ▲
                         │ Scheduler      │──── publie des tâches périodiques ─────┘
                         │ cli/dist/      │
                         │ scheduler      │     Stockage fichiers : local | S3 | GCS | Azure
                         └────────────────┘     SMTP (mails), ClamAV (optionnel)
```

| Processus | Entrée source | Binaire produit | Rôle |
|---|---|---|---|
| **API** | `api/src/server.js` | `api/dist/server` | API HTTP : REST générique `/v2/<modèle>`, pagination `/connection/<modèle>`, agrégations de statements, authentification (JWT, Basic client, Google, OAuth2 client_credentials), uploads, exports CSV. Voir [03-api-auth.md](03-api-auth.md). |
| **UI server** | `ui/src/server.js` | `ui/dist/server` | Sert la SPA React (pas de vrai SSR), proxifie `/api`, et **émet les JWT des dashboards partagés** (`/dashboards/:id/:shareableId`). Voir [05-front.md](05-front.md). |
| **Worker** | `worker/src/server.js` | `worker/dist/server` | Consomme les files de messages : extraction des personas, cache du query builder, statement forwarding, suppression par lots, import CSV de personas, notifications d'expiration, statistiques d'usage. Voir [04-worker-cli-config.md](04-worker-cli-config.md). |
| **Scheduler** | `cli/src/scheduler.js` | `cli/dist/scheduler` | Tâches périodiques (expiration toutes les 15 min, usage à 3 h, fenêtres de suppression par lots), avec verrous Redis. |
| **CLI** | `cli/src/server.js` | `cli/dist/server` | Administration : `createSiteAdmin`, `migrateMongo`, `requeueStatements`, `batchJobs`, `clearAggregationCache`… |
| **xapi-service** | dépôt séparé | — | Endpoint xAPI conforme 1.0.3 : statements, state, profils d'activité et d'agent, pièces jointes. |

En production, les quatre premiers processus sont lancés par **pm2** (`pm2/all.json`, `yarn start`), depuis la racine du dépôt (le `cwd` compte : `.env`, `lib/templates/emails`, `storage/tmp`, `.git` pour `/api/app/version`).

## 3. Flux principaux

### 3.1 Ingestion d'un statement

1. Un outil (LMS, SCORM wrapper, app…) envoie un statement à `POST /data/xAPI/statements` avec les identifiants Basic d'un **client** (`client.api.basic_key` / `basic_secret`) ou un token OAuth2 (`oAuthTokens`).
2. **xapi-service** valide, insère dans `statements`, met à jour `fullActivities` et `lrs.statementCount`, stocke les pièces jointes, puis signale le nouveau statement dans Redis : `RPUSH {REDIS_PREFIX}:statement.new` et `PUBLISH {REDIS_PREFIX}:statement.notify`.
3. Le **worker** (`listenForRedisPublish.js`) dépile la liste et lance l'orchestrateur `statementHandler`. Celui-ci publie le statement dans trois files (filtrables par `ALLOWED_WORKER_QUEUES`) :
   - `STATEMENT_PERSON_QUEUE` : rattachement à une persona (`personas`, `personaIdentifiers`) et écriture de `statements.person` et `personaIdentifier` ;
   - `STATEMENT_QUERYBUILDERCACHE_QUEUE` : alimentation de `queryBuilderCaches` et `queryBuilderCacheValues` (autocomplétion du query builder) ;
   - `STATEMENT_FORWARDING_QUEUE` : envoi HTTP vers les destinations configurées (`statementForwarding`), avec tentatives et file de lettres mortes.
4. L'avancement est tracé dans le document statement : `processingQueues`, `completedQueues`, `*ForwardingQueue`, `failedForwardingLog`.

**Redis est donc obligatoire**, quel que soit `QUEUE_PROVIDER`.

### 3.2 Consultation dans l'interface

1. Le navigateur charge la SPA, se connecte (`POST /api/auth/jwt/password`), choisit une organisation (`POST /api/auth/jwt/organisation`) et obtient un JWT d'organisation.
2. Les listes passent par `/api/connection/<modèle>` (pagination par curseur), les fiches par `/api/v2/<modèle>/:id`, avec sauvegarde automatique (`PATCH` du document complet 1 s après la dernière modification).
3. **Les visualisations construisent leur pipeline d'agrégation MongoDB dans le navigateur** (`ui/src/utils/visualisations`), puis appellent `/api/statements/aggregateAsync?pipeline=…`. L'API préfixe un `$match` de périmètre (organisation, LRS, filtre utilisateur), exécute le pipeline et met le résultat en cache Redis.
4. Pour un dashboard partagé, le serveur **recalcule** les pipelines attendus avec le même code front et refuse tout pipeline différent.

### 3.3 Multi-organisation et droits

- Une **organisation** contient des LRS (« stores »), des clients API, des rôles, des dashboards, des visualisations, des personas. Les organisations peuvent être hiérarchiques (`parent`) et expirer (`expiration`).
- Un **utilisateur** appartient à plusieurs organisations. Pour chacune, `organisationSettings` porte ses rôles et un **filtre de statements** appliqué à toutes ses requêtes.
- Les droits reposent sur des **scopes** : scopes site (`site_admin`, `site_can_create_org`), scopes de rôle (`all`, `org/all/dashboard/view`…), scopes de client (`xapi/all`, `statements/read`…). Détail dans [03-api-auth.md §3](03-api-auth.md).

## 4. Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `api/` | Serveur API : `src/routes/HttpRoutes.js` (toutes les routes), `src/controllers/`, `src/auth/` (passport, JWT), tests supertest (`src/routes/tests/`). |
| `ui/` | Front React : `src/server.js` (serveur Node), `src/client.js`, `src/pages/`, `src/containers/`, `src/components/`, `src/redux/`, `src/utils/` (dont **`utils/visualisations`**, cœur métier des pipelines). |
| `worker/` | `src/handlers/*` : un dossier par type de traitement. |
| `cli/` | `src/server.js` (commandes commander), `src/scheduler.js`, `src/migrateMongo/` (moteur de migrations), `src/commands/v2-migrations/` (les 16 migrations), `src/commands/v1-migrations/`. |
| `lib/` | Code partagé : `models/` (schémas Mongoose), `services/` (auth, queue, files, persona, importPersonas, querybuildercache, statements), `constants/` (scopes, routes, noms de files), `helpers/` (`parseQuery`, `update$dteTimezone`…), `connections/` (Mongo, Redis, SMTP, persona-service), `routes/` (routes **router5 du front**, partagées), `templates/emails/`, `tools/` (config webpack commune). |
| `pm2/` | Fichiers de lancement pm2 (tout-en-un, API+UI seul, worker seul, dev, test). |
| `storage/` | Stockage local par défaut (`logos/`, `downloads/`, `statements/` pour les pièces jointes, `tmp/`). |
| `nginx.conf.example`, `.env.example` | Modèles de configuration. |

**Couplages à connaître :**
- Le backend importe du code du dossier `ui/` : `lib/services/statements/utils/checkDashboardAuth.js` importe `ui/utils/visualisations/pipelinesFromQueries` ; `api/src/auth/passport.js` et `cli/src/seed` importent `ui/utils/auth`. On ne peut pas supprimer `ui/` sans extraire ce code.
- `lib/routes/` (routes du front) est dans `lib/` et utilisé par le serveur UI.
- Les alias `api`, `ui`, `lib`, `worker`, `cli` sont résolus par webpack (`lib/tools/getWebpackConfig.js`), pas par Node.

## 5. Stack technique actuelle

| Domaine | Technologie (version effective) |
|---|---|
| Runtime | Node.js 10 (`.nvmrc`), yarn 1 |
| Build | webpack 3 + babel 6 (presets `env`, `react`, `stage-0`), un bundle par application ; `node_modules` requis à l'exécution |
| Backend | Express 4, express-restify-mongoose 3.2, passport 0.4, jsonwebtoken 8, bluebird, highland, lodash, moment |
| Données | MongoDB 4.2 (CI), Mongoose 5.8 (driver 3.3), driver `mongodb` 2.2 via `@learninglocker/persona-service` 1.7 |
| Cache / files | Redis 4 (CI), ioredis 4, bull 3 ; alternatives SQS (aws-sdk v2), Google Pub/Sub 0.16, Azure Service Bus 1.x |
| Fichiers | local, S3 (pkgcloud), GCS 1.x, Azure Blob 10.x |
| Front | React 16.8, Redux 3 + redux-saga, router5 4, Immutable 3, react-toolbox (Material), Bootstrap 3 CSS, recharts 1, react-grid-layout, styled-components 4, popsicle (HTTP) |
| Tests | mocha 2 + mocha-webpack (api, lib, worker, cli), jest 19 + enzyme (ui) |
| Exploitation | pm2, nginx, winston 2 (+ CloudWatch), New Relic 4 (optionnel), ClamAV (optionnel) |
| CI | CircleCI : `node:10`, `mongo:4.2`, `redis:4` |

Paquets internes Learning Locker utilisés : `@learninglocker/persona-service` (gestion des personas, son propre client Mongo), `@learninglocker/xapi-statements` (utilitaires de xapi-service, utilisé par le worker et une migration), `@learninglocker/xapi-validation` (regex IFI, validation de l'`authority`).

## 6. Build et exécution actuels

```bash
yarn install                 # compile les modules natifs depuis les sources (.yarnrc)
yarn build-all               # api, ui server, ui client, cli, worker → */dist
node cli/dist/server migrateMongo --up            # yarn migrate
node cli/dist/server createSiteAdmin <email> <org> <motdepasse>
yarn start                   # pm2 start pm2/all.json
```

- `.env` est lu par une bannière injectée en tête de chaque bundle (`dotenv`, relatif au `cwd`).
- Certaines variables sont **figées au build** : `NODE_ENV`, `COOKIE_DOMAIN`, `ENABLE_REACT_DEVTOOLS`. Les modifier impose de recompiler.
- Détails du pipeline de build : [04-worker-cli-config.md §5.5](04-worker-cli-config.md).
