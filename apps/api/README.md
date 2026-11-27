# API Learning Locker 2026 (`apps/api`)

Réécriture de l'API HTTP d'origine (`legacy/api`, Express 4) en TypeScript : NestJS 12 sur Express 5,
Mongoose 9 (MongoDB 4.4 au minimum), ioredis. Les réponses sont identiques à celles de l'ancienne API.
Preuve : la référence golden (`tools/golden`, voir plus bas).

## Lancer

```bash
npm ci
npm run build -w @ll/shared && npm run build -w @ll/api
cd /chemin/de/l/ancien/ll   # le fichier .env est lu dans le répertoire courant, comme avant
node /chemin/du/depot/apps/api/dist/main.js
```

Image Docker (contexte : racine du dépôt) :

```bash
docker build -f apps/api/Dockerfile -t ll-api:v2026 .
docker run --env-file ll.env -p 8080:8080 ll-api:v2026
```

L'image tourne avec l'utilisateur `node` et écoute sur `API_PORT`.

## Configurer

Mêmes variables, mêmes défauts et même lecture que l'API d'origine (docs/04 §5.1) : l'ancien `.env`
fonctionne tel quel. Le fichier `.env` du répertoire courant est lu comme le faisait dotenv 2
(les variables déjà définies dans l'environnement gagnent ; pas de commentaire en fin de ligne).

Variables lues : `API_PORT` (obligatoire), `API_HOST`, `NODE_ENV`, `APP_SECRET`, `SITE_URL`,
`JWT_ACCESS_TOKEN_EXPIRATION`, `JWT_REFRESH_TOKEN_EXPIRATION`, `GOOGLE_ENABLED`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `ENABLE_STATEMENT_DELETION`, `RESTRICT_CREATE_ORGANISATION`, `MAX_TIME_MS`,
`MONGODB_PATH`, `MONGO_CONNECTION_POOLSIZE`, `MONGO_SOCKET_TIMEOUT_MS`, `REDIS_URL`, `REDIS_HOST`,
`REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`, `REDIS_PREFIX`, `EVENTS_REPO`, `SENTINEL_*`,
`LOG_MIN_LEVEL`, `COLOR_LOGS`, `TESTING`, `SMTP_*`, `LL_FROM_NAME`, `LL_FROM_EMAIL`.

Différences voulues :
- sans `API_PORT`, l'API s'arrête avec le message d'erreur d'origine (l'ancienne restait démarrée sans écouter) ;
- elle refuse de démarrer si une fonctionnalité reportée est configurée (décision D2) : `FS_REPO`
  autre que `local`, `QUEUE_PROVIDER` autre que `REDIS`/`BULL`, New Relic, CloudWatch ;
- elle ne crée ni collection ni index (rôle des migrations du CLI).

Nouvelle variable : `LEGACY_API_URL`.

## Relais vers l'API legacy (méthode « strangler »)

Avec `LEGACY_API_URL` (ex. `http://api-legacy:8080`), toute requête qu'aucune route portée ne traite
est relayée telle quelle à l'ancienne API : méthode, chemin, query string, en-têtes et corps en flux
(multipart et binaire compris). La réponse est recopiée à l'identique (statut, en-têtes dont les
`Set-Cookie` multiples, corps). Les jetons sont compatibles (même `APP_SECRET`).

Sans `LEGACY_API_URL`, une route non portée répond comme une route inconnue de l'ancienne API
(404 HTML d'Express).

## Routes portées

| Domaine | Routes |
|---|---|
| Divers | `GET /`, `/app/version`, `/app/googleAuth`, `/oauth2/failed` |
| Authentification | `POST /auth/jwt/password`, `/auth/jwt/organisation`, `/auth/jwt/refresh`, `/oauth2/token`, `/auth/resetpassword/request`, `/auth/resetpassword/reset` ; `GET /auth/client/info`, `/auth/jwt/success`, `/auth/jwt/google[/callback]` (comportement sans identifiants Google) |
| Lectures REST | `GET /v2/<modèle>`, `/v2/<modèle>/count`, `/v2/<modèle>/:id` pour les 21 modèles d'express-restify-mongoose |
| Pagination et index | `GET /connection/<modèle>`, `GET /indexes/<modèle>` (19 modèles) |
| Comptages | `GET /statements/count`, `GET /v2/persona/count` |

Tout le reste passe par le relais : écritures REST, `/v2/<modèle>/:id/shallow` (ne répond jamais dans
le legacy), agrégations, personas, téléchargements, imports, exports, flux Google complet.

## Organisation du code

| Dossier | Contenu |
|---|---|
| `src/main.ts`, `src/app.ts`, `src/app.module.ts` | Démarrage, Express 5 réglé comme Express 4 (query string « extended », CORS, cookies, en-têtes anti-cache) |
| `src/config/` | Lecture de la configuration et du `.env` |
| `src/relay/` | Relais et route attrape-tout (toujours enregistrée en dernier) |
| `src/http/` | Erreurs (pages d'Express, `{ errorId, message }`), corps des requêtes, JSON au format de Node 10 |
| `src/db/` | Connexion et modèles Mongoose (mêmes collections, champs hérités tolérés) |
| `src/auth/` | JWT, stratégies (sémantique de passport), routes d'authentification |
| `src/scopes/` | Filtres de droits par modèle (`getScopeFilter`, `getScopeSelect`) |
| `src/rest/`, `src/statements/`, `src/persona/` | Lectures REST, connection, index, comptages |
| `src/mail/`, `templates/emails/` | Courriels (réinitialisation du mot de passe) |

Chaque fichier cite en en-tête le code d'origine qu'il porte.

## Tests

```bash
npm test                                    # depuis la racine
MONGO_TEST_URL=mongodb://127.0.0.1:27017/ll_test_api npm test
```

Les tests d'intégration ont besoin de MongoDB (`MONGO_TEST_URL`) ; la base doit s'appeler
`ll_test_*` (garde-fou). Sans cette variable, ils sont sautés. La CI fournit MongoDB 8.0 et Redis 7.

## Référence golden

Sur la VM, depuis `~/legacy`, après avoir construit l'image :

```bash
export LEGACY_MONGO=4.4
API_IMAGE=ll-api:v2026 DIFF_ARGS="--max 60" ./golden/record-legacy.sh
```

Écarts acceptés (`tools/golden/accepted.json`) : 5 réponses d'erreur où l'API legacy renvoyait la pile
d'appel de l'erreur (`stack`, chemins internes du serveur). Le reste du corps est identique.
