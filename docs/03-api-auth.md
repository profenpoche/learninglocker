# 03. API HTTP, authentification et autorisations

> [Index de la documentation](README.md) · État du code : commit `5fec948a` (novembre 2021).

Périmètre : `api/` et la partie HTTP/auth de `lib/`.

**Limite importante.** `node_modules` n'est pas installé dans le dépôt : `ls node_modules | wc -l` renvoie 0. Le comportement interne d'`express-restify-mongoose` (yarn.lock : **3.2.1**) est donc décrit de mémoire, d'après la documentation de la v3. Ces passages sont signalés « (erm, à vérifier) ».

---

## 0. Ce que le front Angular devra respecter

1. **Toutes les routes sont montées à la racine du serveur API** (`api/src/server.js:24`, `app.use(HttpRoutes)`). En production, elles sont exposées sous le préfixe `/api` :
   - par nginx (`nginx.conf.example`, `location ~* ^/api(.*)$` → `proxy_pass http://127.0.0.1:API_PORT$1`) ;
   - ou par le serveur UI (`ui/src/server.js:65`, `http-proxy`).

   **Plusieurs éléments codent `/api` en dur** :
   - le chemin du cookie de refresh (`AuthController.js:25`) ;
   - les redirections Google (`AuthController.js:269`, `HttpRoutes.js:157`) ;
   - `logoPath` (`lib/services/files/uploadLogo.js:16`) ;
   - l'URL de téléchargement d'un export (`lib/services/files/exportStatements.js:59`) ;
   - le `callbackURL` Google (`api/src/auth/passport.js:208`).
2. **Authentification utilisateur** : JWT HS256 signé avec `APP_SECRET`, renvoyé **en `text/plain`** dans le corps de la réponse. Le refresh token est un **cookie HttpOnly** posé par l'API.
3. **Le cookie d'access token est posé par le front, pas par l'API.** Il est lisible en JS et nommé `access_token_<tokenType>_<tokenId>`. Il est indispensable aux téléchargements par lien (logo, CSV) via la stratégie `jwt-cookie`.
4. **Le serveur UI actuel porte des responsabilités serveur** qui disparaîtront avec le front React :
   - émission des **tokens de dashboards partagés** (`ui/src/controllers/renderDashboard.js`) ;
   - contrôle de visibilité et du Referer pour l'embarquement ;
   - injection SSR de `RESTRICT_CREATE_ORGANISATION` et `ENABLE_STATEMENT_DELETION` (`ui/src/controllers/renderApp.js:24-29`) ;
   - logs d'accès morgan, helmet et compression (`ui/src/server.js`).
5. **Le backend importe du code du front React.** Il faut le conserver ou l'extraire en librairie partagée :
   - `api/src/auth/passport.js:17` importe `ui/utils/auth` (noms des cookies) ;
   - `lib/services/statements/utils/checkDashboardAuth.js:14` importe `ui/utils/visualisations/pipelinesFromQueries` ;
   - `cli/src/seed/index.js:4` importe `ui/utils/auth`.

   Pour un token de dashboard, le pipeline d'agrégation envoyé doit être **strictement identique** (égalité Immutable) à celui que le serveur régénère avec `pipelinesFromQueries`. Le front Angular devra produire des pipelines identiques à l'octet près.
6. **Les endpoints xAPI (`/data/xAPI/*`) ne sont pas dans ce dépôt.** nginx les proxifie vers `XAPI_PORT`, un service séparé (xapi-service). Ce service partage la collection `client` (`api.basic_key`, `api.basic_secret`, `isTrusted`, `scopes`, `lrs_id`, `authority`) et, probablement, `oAuthTokens`. Le schéma `lib/models/client.js` est donc un contrat inter-services.

---

## 1. Démarrage du serveur API

### 1.1 `api/src/server.js`

| Élément | Détail |
|---|---|
| Framework | Express 4 (`express ^4.13.4`) |
| Middlewares, dans l'ordre | `cors({ origin: '*', preflightContinue: true })` (l.15-17) et `app.options('*', corsMiddleware)` (l.18) ; `bodyParser.json({ limit: '5mb' })` (l.20) ; `bodyParser.urlencoded({ extended: false })` (l.21) ; `cookieParser()` (l.22) ; `passport.initialize()` (l.23) ; `HttpRoutes` (l.24) |
| Dans le routeur | `setNoCacheHeaders` sur toutes les routes (`HttpRoutes.js:74`, défini dans `lib/constants/auth.js:246-253`) : `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Expires: 0` |
| Absents de l'API | **pas de helmet, pas de compression, pas de morgan**. Ils ne sont que dans `ui/src/server.js`. Pas de gestionnaire d'erreurs global ni de 404 JSON : ce sont les pages HTML par défaut d'Express. Pas de `trust proxy`, donc `req.protocol` vaut toujours `http` derrière nginx et le flag `secure` du cookie de refresh n'est jamais posé (`AuthController.js:32`). |
| Port | `process.env.API_PORT`. S'il est absent, l'erreur est loggée et le serveur n'écoute pas (l.43-45). Écoute sur toutes les interfaces ; `API_HOST` ne sert qu'au message de log. |
| pm2 | `if (process.send) process.send('ready')` (l.39). `pm2/all.json` : `wait_ready: true`, `listen_timeout: 30000`, `exec_mode: cluster`, 1 instance, `node_args: --max-old-space-size=256 --max-semi-space-size=2`, `watch: [".env"]`. |
| Signaux | `SIGINT` → `process.exit(0)` (l.12-14) |
| `source-map-support` | installé l.10, et aussi dans la bannière webpack |
| Export | `export default app`, utilisé par supertest dans `lib/connections/supertestApi.js` |

### 1.2 Build (`api/build.js`, `lib/tools/getWebpackConfig.js`)

- Commandes : `babel-node api/build [--release] [--watch] [--stats] [--verbose]`. Sortie dans `api/dist/server/index.js`, lancée par `node api/dist/server` (`start-api-server`).
- Configuration webpack 3 commune à l'UI : `target: 'node'`, `libraryTarget: commonjs2`, `webpack-node-externals`, `HardSourceWebpackPlugin`, babel-loader 6. Le `.babelrc` utilise les presets `react`, `env`, `stage-0` et les plugins `transform-runtime`, `decorators-legacy`, etc.
- Alias : `api` → `api/src`, `ui` → `ui/src`, `lib` → `lib`, `worker`, `cli`.
- **Bannière injectée en tête du bundle** (`getWebpackConfig.js:62-75`) :
  - `dotenv.config()`, ou `.env.test` si `RUNTIME_NODE_ENV=test` ;
  - le bloc New Relic produit par `lib/tools/newrelicConfig.js` : si `NEW_RELIC_LICENSE_KEY` est défini, il positionne `NEW_RELIC_NO_CONFIG_FILE=true`, `NEW_RELIC_APP_NAME=$NEWRELIC_API_NAME`, `NEW_RELIC_LOG=$LOG_DIR/newrelic-agent.log`, `NEW_RELIC_LOG_LEVEL=info`, puis fait `require("newrelic")` ;
  - `require("source-map-support").install()`.
- Tests : `api/testConfig.js` réaffecte `MONGODB_PATH=MONGODB_TEST_PATH`, `API_PORT=TEST_API_PORT`, `SMTP_PASS=TEST_SMTP_PASS`, `LOG_MIN_LEVEL=TEST_LOG_MIN_LEVEL` et `TESTING=true`. Lancement par `mocha-webpack`.
- `.nvmrc` = `10`. La CI (`.circleci/config.yml`) tourne avec `node:10`, `mongo:4.2` et `redis:4`.

### 1.3 Variables d'environnement lues (api/src et lib)

- **Serveur et authentification** : `API_PORT`, `API_HOST`, `APP_SECRET`, `JWT_ACCESS_TOKEN_EXPIRATION` (défaut `1h`), `JWT_REFRESH_TOKEN_EXPIRATION` (défaut `7d`), `SITE_URL`, `COOKIE_DOMAIN` (côté front, `HOSTNAME` y est remplacé par `location.hostname`), `GOOGLE_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **Fonctionnel** : `ENABLE_STATEMENT_DELETION` (défaut true), `RESTRICT_CREATE_ORGANISATION` (défaut true), `MAX_TIME_MS`, `ALLOW_AGGREGATION_DISK_USE`, `AGGREGATION_CACHE_SECONDS` (300), `AGGREGATION_REFRESH_AT_SECONDS` (120), `ASYNC_AGGREGATION_WAITING_MS` (0), `ASYNC_AGGREGATION_CACHE_SECONDS` (604800), `ASYNC_AGGREGATION_TIMEOUT_MS`, `ASYNC_AGGREGATION_REFRESH_AFTER_SECONDS` (60).
- **Mongo et Redis** : `MONGODB_PATH`, `MONGO_CONNECTION_POOLSIZE` (20), `MONGO_SOCKET_TIMEOUT_MS` (300000), `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`, `REDIS_PREFIX`, `SENTINEL_*`, `QUEUE_PROVIDER`, `QUEUE_NAMESPACE`, `AWS_SQS_*`, `PUBSUB_GOOGLE_CLOUD_*`, `SERVICE_BUS_ENDPOINT`.
- **Fichiers** : `FS_REPO` (local, amazon, azure, google, rackspace…), `FS_SUBFOLDER`, `FS_LOCAL_ENDPOINT`, `FS_AWS_S3_*`, `FS_AZURE_*`, `FS_GOOGLE_CLOUD_*`, `FS_RACK_*`, `CLAMDSCAN_BINARY`, `CLAMDSCAN_CONF`.
- **Mail et logs** : `SMTP_*`, `LL_FROM_EMAIL`, `LL_FROM_NAME`, `LOG_MIN_LEVEL`, `LOG_DIR`, `COLOR_LOGS`, `WINSTON_CLOUDWATCH_*`, `NEW_RELIC_*`, `NEWRELIC_API_NAME`.

---

## 2. Inventaire complet des routes

Les chemins sont relatifs à la racine de l'API. Le chemin public est `/api` + le chemin.

Notation des stratégies d'authentification :
- **jwt** : Bearer JWT. Avec `passport-http-bearer`, le token est accepté dans le header `Authorization: Bearer`, **mais aussi dans `?access_token=` ou dans le champ `access_token` du corps**.
- **basic** : `clientBasic`, c'est-à-dire la clé et le secret d'un client API.
- **cookie** : `jwt-cookie`.

Les constantes de chemins sont dans `lib/constants/routes.js`.

### 2.1 Divers, sans authentification

| Méthode | Chemin | Contrôleur | Réponse |
|---|---|---|---|
| GET | `` (racine) | inline `HttpRoutes.js:76` | 200 `OK`, texte brut (health check ; nginx réécrit `location = /api`) |
| GET | `/app/version` | inline l.77-88, via `git-rev` | `{ short, long, branch, tag }`. Nécessite le binaire `git` et le dossier `.git` à l'exécution. |
| GET | `/app/googleAuth` | inline l.89-92 | `{ enabled: boolean(GOOGLE_ENABLED) }` |

### 2.2 Authentification (`api/src/controllers/AuthController.js`)

| Méthode | Chemin | Auth | Contrôleur | Contrat |
|---|---|---|---|---|
| POST | `/auth/resetpassword/request` | aucune | `resetPasswordRequest` | Corps `{ email }` → 204 vide, que l'utilisateur existe ou non. Envoi d'un mail (`lib/helpers/email`). Token = `bcrypt(email)` valable 24 h, stocké dans `user.resetTokens`. 500 `{ message }` si la sauvegarde échoue. |
| POST | `/auth/resetpassword/reset` | aucune | `resetPassword` | Corps `{ email, token, password }`. 400 `{ message: 'You must enter a password' }` ; 404 `{ message: 'Invalid password reset token…' }` ; erreur de validation Mongoose → 400, corps = objet `ValidationError` (le front lit `body.errors.password.message`). **200 avec le document User complet, y compris le hash du mot de passe, `passwordHistory` et `resetTokens`** (l.122, fuite d'information). |
| POST | `/auth/jwt/password` | header `Authorization: Basic base64(email:password)`, stratégie `userBasic` | `jwt` | **Login.** Le front envoie l'email en minuscules. 200 : `Content-Type: text/plain`, corps = **JWT utilisateur**, plus le cookie `refresh_token_user_<userId>` (voir §3.4). Échec : 401 JSON `{ success: false, message: 'Incorrect login details' }`, ou `There was an error (code: …)`. Le header `WWW-Authenticate` est retiré. Verrouillage (lockout) selon `user.ownerOrganisationSettings.LOCKOUT_ENABLED`, `LOCKOUT_ATTEMPS` et `LOCKOUT_SECONDS`. |
| POST | `/auth/jwt/organisation` | jwt | `jwtOrganisation` | Corps `{ organisation: <orgId> }`. L'utilisateur doit avoir `orgId` dans `user.organisations`. 200 : `text/plain` = **JWT organisation**, plus le cookie `refresh_token_organisation_<orgId>`. 401 texte `User does not have access to this organisation.` ; 500 sinon. |
| POST | `/auth/jwt/refresh` | aucune (cookie de refresh) | `jwtRefresh` | Corps `{ tokenType: 'user' \| 'organisation', id: <userId \| orgId> }`. Lit le cookie `refresh_token_${tokenType}_${id}`. 200 `text/plain` = nouveau JWT d'accès (user ou organisation). **Le refresh token n'est pas renouvelé (pas de rotation).** 401 `{ errorId, message: 'Unauthorised' }` si le token est absent, invalide ou expiré, ou si l'utilisateur est introuvable. |
| GET | `/auth/client/info` | basic | `clientInfo` | 200 `{ title, organisation, lrs_id, scopes }` du client |
| GET | `/auth/jwt/google` | aucune | `passport.authenticate('google', GOOGLE_AUTH_OPTIONS)` | Enregistrée seulement si `process.env.GOOGLE_ENABLED` est truthy. **Attention : la chaîne `"false"` est truthy.** Avec `GOOGLE_ENABLED=false` (valeur de `.env.example`), la route existe mais la stratégie n'est pas enregistrée, ce qui donne un 500. |
| GET | `/auth/jwt/google/callback` | stratégie google | `googleSuccess` | Succès → redirection 302 vers `/api/auth/jwt/success?access_token=<JWT user, provider 'google'>`. **Aucun refresh token n'est émis pour Google.** Échec → redirection vers `/api/oauth2/failed?error=<message non encodé>`. |
| GET | `/auth/jwt/success` | jwt (le token est lu dans `?access_token=`) | `success` | `Login success!` en texte. Le popup du front lit `access_token` dans l'URL (`ui/src/utils/oauth.js`). |
| GET | `/oauth2/failed` | aucune | inline | `Authorization failed` en texte |
| POST | `/oauth2/token` | aucune (identifiants dans le corps) | `issueOAuth2AccessToken`, stratégie `OAuth2_Authorization` | Corps (form ou JSON) `{ grant_type: 'client_credentials', client_id, client_secret }`. 200 `{ access_token: <uuid v4>, token_type: 'bearer', expires_in: 3600 }`, stocké dans `oAuthTokens` (index TTL, migration `cli/src/commands/v2-migrations/20190131000000_oauth_tokens.js`). 400 `{ error: 'invalid_request' \| 'unsupported_grant_type' \| 'invalid_client' }`. **Ce serveur API n'accepte jamais ces tokens opaques.** Ils sont destinés au service xAPI externe (à confirmer). |
| POST | `/requestAppAccess` | jwt | `RequestAppAccessController.requestAppAccess` | Corps `{ appConfig }`. Envoie un mail à **`hello@learninglocker.net`**, adresse codée en dur. 200 vide, ou 500 `{ errorId, message: 'Access request failed' }`. |

Il n'existe **pas d'endpoint de logout serveur**. Le logout est purement client : suppression des cookies `access_token*` dans `ui/src/redux/modules/auth/logout.js`. Les cookies `refresh_token_*` (HttpOnly) restent valides jusqu'à expiration.

### 2.3 Personas : routes spécifiques (`api/src/routes/personas/*.js`)

Ces routes délèguent au package `@learninglocker/persona-service`. Elles sont enregistrées **avant** restify.

| Méthode | Chemin | Auth | Contrôleur (`PersonaController`) | Contrat |
|---|---|---|---|---|
| GET | `/v2/persona/count` | jwt, basic | `personaCount` | `?query=<JSON>` → `{ count }` |
| GET | `/v2/persona` | jwt, basic | `getPersonas` | `?sort` (JSON), `?limit`, `?skip`, `?filter` ou `?query` (JSON) → tableau de personas avec `id` renommé en `_id` |
| GET | `/v2/persona/:personaId` | jwt, basic | `getPersona` | objet persona (`_id`) |
| POST et PUT | `/v2/persona` | jwt, basic | `addPersona` | Corps `{ name }` → persona |
| POST, PUT et PATCH | `/v2/persona/:personaId` | jwt, basic | `updatePersona` | Corps `{ name }` → persona. Réassigne aussi le nom dans les statements. |
| DELETE | `/v2/persona/:personaId` | jwt, basic | `deletePersona` | 200, résultat du service. 400 si la persona a encore des identifiants. |
| GET | `/connection/persona` | jwt, basic | `personaConnection` | `?filter`, `?sort`, `?hint`, `?project` (JSON), `?first`, `?last`, `?after`, `?before` → `{ edges, pageInfo }` produits par persona-service (taille par défaut 10) |
| POST | `/mergepersona` | jwt, basic | `mergePersona` | **Paramètres dans la query string** : `?mergePersonaFromId=&mergePersonaToId=`. Le handler est enregistré deux fois (doublon, `personaRESTHandler.js:61-71`). |

Routes de `PersonaIdentifierController` :

| Méthode | Chemin | Contrat |
|---|---|---|
| GET | `/v2/personaIdentifier/count` | `?query` → `{ count }` |
| GET | `/v2/personaIdentifier` | `sort`, `limit`, `skip`, `filter` ou `query` (la clé `persona` est extraite) → tableau |
| GET | `/v2/personaIdentifier/:personaIdentifierId` | objet |
| POST et PUT | `/v2/personaIdentifier` | Corps `{ ifi: { key, value }, persona }` → identifiant. L'IFI est validé (erreurs rulr → 400 `{ errorId, message }` ou `{ errorId, messages[] }`). |
| POST | `/v2/personaIdentifier/upsert` | Corps `{ ifi, persona? }`. Sans `persona`, crée une persona nommée par `JSON.stringify(ifi)`. |
| POST, PUT et PATCH | `/v2/personaIdentifier/:personaIdentifierId` | Corps `{ persona }`, obligatoire (sinon 400) |
| DELETE | `/v2/personaIdentifier/:personaIdentifierId` | 400 si des statements utilisent l'IFI ; sinon 200 vide |
| GET | `/connection/personaidentifier` | même format que `/connection/persona`. La clé `persona` du filtre est convertie en ObjectId. |

Toutes ces routes acceptent jwt et basic. Le chemin utilise `personaIdentifier` en camelCase dans `/v2/…`, mais `personaidentifier` en minuscules dans `/connection/…`.

Autorisation : `getScopeFilter({ modelName: 'persona' | 'personaIdentifier', actionName })` sert uniquement à lever une erreur 403 si l'accès est refusé. L'organisation vient de l'`authInfo`.

### 2.4 Utilisateurs et organisations (`api/src/routes/userOrganisations/router.js`, `userOrganisationSettings/router.js`)

| Méthode | Chemin | Auth | Garde | Contrôleur | Contrat |
|---|---|---|---|---|---|
| DELETE | `/v2/users/:userId/organisations/:organisationId` | jwt | token de type `organisation` avec `tokenId === :organisationId`, et un scope parmi `site_admin`, `all`, `org/all/user/manage` | `UserOrganisationsController.delete` | 200 vide ; 404 si l'utilisateur est introuvable |
| POST | `/v2/users/:userId/organisationSettings/:organisationId` | jwt | idem | `UserOrganisationSettingsController.create` | Corps = `organisationSettings` (`{ organisation?, scopes, roles, filter, timezone }`). 400 si doublon ou si l'organisation du corps diffère de l'URL. Renvoie le setting créé. |
| PATCH | idem | jwt | token org = `:organisationId`, et (scope de gestion **ou** `token.userId === :userId`) | `.update` | Clés modifiables : `site_admin` → toutes ; `all` ou `org/all/user/manage` → `filter`, `roles`, `scopes` ; soi-même → `samlEnabled` seulement. Sinon 400. Renvoie le setting (`undefined` s'il vient d'être créé, bug l.83). |
| DELETE | idem | jwt | comme POST | `.delete` | 200 vide |

Note : en cas de refus, `checkAuth` envoie 401 puis appelle `next('route')`, donc l'en-tête est envoyé deux fois (bug mineur).

### 2.5 Uploads et imports

| Méthode | Chemin | Auth | Contrôleur | Contrat |
|---|---|---|---|---|
| POST | `/uploadlogo?data=<orgId>` | jwt | `UploadController.uploadLogo` | multipart (multiparty ; premier fichier, quel que soit le nom du champ ; fichiers temporaires dans `${cwd}/storage/tmp`). Types autorisés : png, jpg, jpeg, bmp. Scan ClamAV, stockage `logos/<orgId>`. Requiert le droit d'édition de l'organisation (`runScopeFilterWithOrg`). Renvoie 200 avec la **chaîne** `/api/downloadlogo/<orgId>` et met à jour `org.logoPath`. |
| POST | `/uploadpersonas` | jwt, basic | `ImportPersonasController.uploadPersonas` | multipart : champ `id` (id d'un `PersonasImport`) et un fichier CSV. Renvoie le `PersonasImport` en JSON. |
| POST | `/importpersonas` | jwt, basic | `importPersonas` | Corps `{ id }` → `PersonasImport`. 409 si déjà en cours de traitement. |
| GET | `/organisation/:organisationId/importpersonaserror/:id.csv` | jwt, cookie, basic | `importPersonasError` | Flux `text/csv` (CSV d'erreurs, ou CSV source) |
| POST | `/uploadpersona` | jwt, cookie, basic | `uploadJsonPersona` | Corps `{ personaName?, ifi?, ifis: [], attribute?, attributes?: [{ key, value }] }`. **`ifis` doit être un tableau**, sinon 500. Renvoie `{ merged: boolean }`. |

### 2.6 Téléchargements et exports

| Méthode | Chemin | Auth | Contrôleur | Contrat |
|---|---|---|---|---|
| GET | `/downloadlogo/:org` | jwt, cookie (cookie utilisateur, premier nom commençant par `access_token_user_`) | `DownloadController.downloadLogo` | Flux binaire, `Content-Type` = mime du logo. Une organisation absente provoque un 500. |
| GET | `/organisation/:organisationId/downloadexport/:download.csv` | jwt, cookie (cookie `access_token_organisation_<organisationId>`) | `DownloadController.downloadExport` | Flux CSV. 404 si le `Download` n'existe pas dans le scope. |
| GET | `/export?exportId=&pipelines=<JSON [[…],[…]]>&type=` | jwt | `ExportController.downloadExport` | Crée un `Download` et génère le CSV (fast-csv et highland) en arrière-plan. Renvoie le `Download` en JSON au bout de 2 s maximum (`isReady` peut valoir false). `pipelines` invalide → 500 `Invalid pipelines`. |

### 2.7 Statements et agrégations (`StatementController`, `StatementMetadataController`, `BatchDeleteController`)

| Méthode | Chemin | Auth | Contrat |
|---|---|---|---|
| GET | `/statements/aggregate` | jwt, basic | Query : `pipeline` (JSON, **obligatoire**), `limit` (-1), `skip` (0), `cache` (`true`/`false`, cache Redis), `maxTimeMS`, `sampleSize`. Réponse : **tableau JSON brut** de documents statements ; les clés `&46;` sont décodées en `.` par `mapDot`. Le serveur ajoute en tête un `$match` de scope, plus `$sample` si `sampleSize` est fourni. `$out` est supprimé et `$lookup` est restreint à une liste blanche de collections, chacune filtrée par scope. |
| GET | `/statements/aggregateAsync` | jwt, basic | Query : `pipeline`, `skip`, `limit`, `sinceAt`. Réponse `{ result: [...] \| null, status: { startedAt, completedAt, isRunning } }`, avec cache Redis 7 jours et rafraîchissement après 60 s. |
| GET | `/statements/count` | jwt, basic | `filter` ou `query` (JSON), `maxTimeMS`, `hint` → `{ count }`. Raccourci via `lrs.statementCount` si aucun filtre n'est fourni. |
| GET | `/v1/statements/aggregate` | jwt, basic | Compatibilité v1 : `{ "waitedMS": 0, "result": [...], "ok": 1 }` |
| PATCH | `/v2/statementmetadata/:id` | jwt, basic | Corps = objet de métadonnées, fusionné sous `metadata.<clé>` (les `.` sont encodés). Renvoie `{ _id, metadata }`. **Requiert le scope `xapi/all` ou `statements/write`** (le scope `all` ne suffit pas). |
| POST | `/v2/statementmetadata/:id` | jwt, basic | Remplace entièrement `metadata`. Mêmes réponse et droits. |
| POST | `/v2/batchdelete/initialise` | jwt, basic | Corps `{ filter }`, non vide (sinon 400). Crée un `BatchDelete` et le publie dans la file `BATCH_STATEMENT_DELETION_QUEUE`. Renvoie le `BatchDelete`. Requiert `ENABLE_STATEMENT_DELETION` et le scope `statements/delete`. |
| POST | `/v2/batchdelete/terminate/all` | jwt, basic | 204. Marque tous les `BatchDelete` de l'organisation `done` et recalcule les compteurs des LRS. |
| POST | `/v2/batchdelete/terminate/:id` | jwt, basic | 204, ou 404 |

### 2.8 Routes REST générées par `express-restify-mongoose` (`HttpRoutes.js:307-400`)

**Options globales** (`RESTIFY_DEFAULTS`, `lib/constants/auth.js:288-343`) :

| Option | Valeur |
|---|---|
| `prefix` | `''` |
| `version` | `'/v2'`, d'où des URI `/v2/<nommodele en minuscules>` |
| `lowercase` | `true` |
| `lean` | `false` |
| `findOneAndUpdate` | `false` (load, puis merge, puis save : les hooks Mongoose s'exécutent) |
| `findOneAndRemove` | `false` |
| `readPreference` | `'primary'` |
| `preMiddleware` | `passport.authenticate(['jwt','clientBasic'])` avec callback personnalisé (échec → 401 `text/plain` `Unauthorized`). Calcule ensuite `req.ll = { scopeFilter, scopeSelect }` via `getScopeFilterFromReq` et `getScopeSelectFromReq`. Une erreur de scope passe par `handleRequestError`, d'où un 403 ou un 500. |
| `preCreate` et `preUpdate` | `checkOrg` : force `organisation` (ou `organisations` pour User) à l'organisation du token pour les tokens `organisation` et `client` |
| `preRead` | `parseRestifyQuery` : `req._ermQueryOptions.query` passe par `parseQuery`, qui convertit `$oid`, `$dte`, `statement.timestamp` et `statement.stored`, supprime `$out` et filtre `$lookup` |
| `preDelete` | refuse un DELETE sans `:id` (400 `API does not allow bulk deletions`) et écrit un audit `Audit` si le modèle a `auditRemove` |
| `contextFilter` | `model.find({ $and: [ {deleted: {$ne: true}} (si softDeletes et pas ?trashed=true), req.ll.scopeFilter ] })`, plus `.select(scopeSelect)` |
| `onError` | log, puis `res.status(err.statusCode)` si présent, puis `res.send(err)` (objet erreur brut) |

**Routes générées par modèle (erm, à vérifier)** pour `/v2/<m>` :

| Méthode | Chemin | Action de scope (`getActionNameFromReq`) |
|---|---|---|
| GET | `/v2/<m>` | view |
| GET | `/v2/<m>/count` | view → `{ count }` |
| GET | `/v2/<m>/:id` | view |
| GET | `/v2/<m>/:id/shallow` | view |
| POST | `/v2/<m>` | create (201) |
| POST | `/v2/<m>/:id` | edit. **Mise à jour : c'est ce que fait le front React (`LLApiClient.postModel`).** |
| PUT | `/v2/<m>/:id` | edit |
| PATCH | `/v2/<m>/:id` | edit |
| DELETE | `/v2/<m>` | delete. Bloqué par `preDelete`, sauf exceptions ci-dessous. |
| DELETE | `/v2/<m>/:id` | delete (204) |

Paramètres de query erm v3 : `query` (JSON Mongo), `sort`, `skip`, `limit`, `select`, `populate`, `distinct`. Le front envoie chaque valeur sérialisée en JSON (`mapValues(query, JSON.stringify)`).

**Modèles servis** :

| Modèle (fichier) | URI | Options propres | Filtre de scope (`lib/services/auth/filters/getScopeFilter.js`) |
|---|---|---|---|
| Organisation (`lib/models/organisation.js`) | `/v2/organisation` | `preUpdate` : retire `expiration` si l'appelant n'est pas `site_admin`. **Remplace `checkOrg`.** | `modelFilters/organisation.js` |
| Stream | `/v2/stream` | — | **aucun cas** → `throw Error('Invalid scope stream requested')` → **500 systématique** (route inutilisable) |
| Export | `/v2/export` | — | shareable (export) |
| Download | `/v2/download` | — | shareable (download) |
| Query | `/v2/query` | — | shareable (query) |
| ImportCsv | `/v2/importcsv` | — | persona (global) |
| User | `/v2/user` | `preCreate` : un non-`site_admin` ne peut envoyer que `name`, `email`, `isExpanded`, `organisations`, puis `checkOrg`. `preUpdate` : un non-`site_admin` ne peut modifier que `name` et `password` s'il se modifie lui-même (`req.body._id` = id du token), sinon `name` seulement. `postCreate`, `postUpdate` et `postDelete` réduisent la réponse aux champs `MANAGER_SELECT`. Un POST avec un email existant fusionne les organisations sur l'utilisateur existant (`lib/models/user.js:300+`). | user |
| Client | `/v2/client` | — | admin (`org/all/client/manage`) |
| Visualisation | `/v2/visualisation` | — | visualisation (shareable avec cas dashboard) |
| Dashboard | `/v2/dashboard` | — | dashboard (shareable avec cas dashboard) |
| Lrs | `/v2/lrs` (« stores ») | — | global (`org/all/store/manage`) |
| Statement | `/v2/statement` | `preCreate` → 405 ; `preUpdate` → 405 ; `preDelete` → 405 si `ENABLE_STATEMENT_DELETION` est faux, 400 sans id (`res.send(body, status)`, signature dépréciée) | statement |
| StatementForwarding | `/v2/statementforwarding` | — | shareable (statementForwarding) |
| QueryBuilderCache | `/v2/querybuildercache` | — | global (`all`) |
| QueryBuilderCacheValue | `/v2/querybuildercachevalue` | — | global (`all`) |
| Role | `/v2/role` | — | admin (vue : `role/manage` ou `user/manage` ; édition : `role/manage`) |
| PersonaAttribute | `/v2/personaattribute` | `preDelete: next()` **retire la garde anti-suppression en masse** : `DELETE /v2/personaattribute?query=…` supprime tous les attributs filtrés de l'organisation | persona (global) |
| PersonasImport | `/v2/personasimport` | — | persona (global) |
| PersonasImportTemplate | `/v2/personasimporttemplate` | — | **aucun cas** → **500 systématique** |
| SiteSettings | `/v2/sitesettings` | — | `{}` : **n'importe quel principal authentifié (utilisateur, organisation, client, dashboard) peut lire et modifier les paramètres du site** |
| BatchDelete | `/v2/batchdelete` | create, update et delete → 405 (lecture seule) | batchDelete |

### 2.9 Routes « connection » (pagination Relay) et « indexes » (`HttpRoutes.js:402-457`)

Pour chacun des modèles de `generatedRouteModels` : organisation, user, statement, statementforwarding, lrs, querybuildercache, querybuildercachevalue, client, dashboard, visualisation, query, export, download, importcsv, role, personaattribute, personasimport, personasimporttemplate (500, pas de filtre), batchdelete.

| Méthode | Chemin | Auth | Contrôleur | Contrat |
|---|---|---|---|---|
| GET | `/connection/<modele>` | jwt, basic (callback personnalisé : 401 `text/plain` `Unauthorized`, sans `WWW-Authenticate`) | `generateConnectionController(model)`, qui appelle `model.getConnection` (`lib/models/plugins/addCRUDFunctions.js:141-260`) | Query : `filter` (JSON, défaut `{}`), `sort` (JSON, défaut `{_id:1}`), `first`, `last` (entiers), `after`, `before` (curseurs), `hint` (JSON), `project` (JSON, intersecté avec la sélection de scope). Réponse : `{ edges: [{ cursor, node }], pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor } }` |
| GET | `/indexes/<modele>` | jwt, basic | `generateIndexesController` | `[{ key, name }]`, index de la collection. Aucune vérification de scope au-delà de l'authentification. |

`/connection/persona` et `/connection/personaidentifier` sont les routes spécifiques décrites au §2.3.

### 2.10 Routes hors du serveur API qui font partie du contrat actuel

| Où | Route | Rôle |
|---|---|---|
| `ui/src/server.js:83-84`, `ui/src/controllers/renderDashboard.js` | `GET /dashboards/:dashboardId[/:shareableId]` | Rendu SSR d'un dashboard partagé. **Génère le JWT dashboard** (`createDashboardJWT`) et l'injecte dans le state Redux. Contrôle de `shareable.visibility` : `NOWHERE` → 403 ; `ANYWHERE` → OK, `X-Frame-Options` retiré ; `VALID_DOMAINS` → le hostname du Referer doit correspondre à `validDomains` (micromatch) ou à `SITE_URL`, sinon 404. **À réimplémenter côté API pour Angular**, par exemple avec un endpoint public d'émission de token dashboard. |
| `ui/src/server.js:65` | `/api/*` | proxy http-proxy vers l'API ; erreur → 500 `{ error: 'proxy_error', reason }` |
| nginx | `/data/xAPI/*` | service xAPI externe |
| `ui/src/server.js` | `*` | SPA ; helmet (frameguard selon `ENABLE_FRAMEGUARD`), compression, logs morgan dans `LOG_DIR/access-%DATE%.log` |

### 2.11 Incohérences front/API constatées

- `LLApiClient.assignPersona` appelle `POST /assignpersona` et `createPersonaFromIdentifier` appelle `POST /createpersonafromidentifier` (`ui/src/utils/LLApiClient.js:201-220`). **Ces routes n'existent pas dans l'API** (404). Les constantes existent dans `lib/constants/routes.js:40-41`.
- `SENDSMS` (`/sendsms`) : constante sans route.
- `getAppData(key)` appelle `GET /app/<key>`. Seuls `version` et `googleAuth` existent ; les autres clés sont injectées en SSR.

### 2.12 Routes du front React (`lib/routes/index.js`, router5) à reproduire dans Angular

| Nom | Chemin | Garde |
|---|---|---|
| `login`, `reset`, `forgot` | `/login`, `/reset?email&token`, `/forgot` | `login` : `requireNoLogin` |
| `admin` (`users`, `users.id`, `organisations`, `organisations.id`) | `/admin/...` | `requireSiteAdmin` |
| `home` | `/home` | `requireLogin` |
| `organisation` | `/organisation/:organisationId` | `requireOrgLogin` : connexion automatique via `/auth/jwt/organisation` |
| `organisation.data` | `/data`, avec `dashboards[/add\|/:dashboardId]`, `visualise[/:visualisationId]`, `source`, `statementforwarding` | — |
| `organisation.people` | `/people/{imports,manage[/:personaId],reconcile}` | — |
| `organisation.settings` | `/settings/{clients,organisations,stores,users,roles,apps}` | `requireModelViewScope(model)` via `lib/services/auth/canViewModel.js` (`org/all/<m>/manage`, `site_admin` ou `all`) |
| `organisation.apps` | `/apps[/salesDemo]` | — |
| `embedded-dashboard` | `/dashboards/:dashboardId/:shareableId/*splat?:filter` | — |

Gardes définies dans `lib/routes/auth.js`. Création d'organisation : `lib/services/auth/canCreateOrganisations.js`.

---

## 3. Authentification et autorisation

### 3.1 Stratégies passport (`api/src/auth/passport.js`)

| Nom | Type | Source | Résultat (`req.user`) |
|---|---|---|---|
| `jwt` | `passport-http-bearer` | header Bearer, `?access_token=` ou `body.access_token` | `{ ...user.toObject(), authInfo: { user, token: <payload décodé> } }`. Pour un token dashboard, pas de champs utilisateur. |
| `jwt-cookie` | `passport-custom` | cookie `access_token_organisation_<req.params.organisationId>` si le paramètre existe, sinon le premier cookie dont le nom commence par `access_token_user_` | idem `jwt` |
| `userBasic` | `passport-http` Basic | email:password, vérification bcrypt | ne sert qu'au login (`/auth/jwt/password`). Renvoie `{ user, success, reason, clearLockout }`. |
| `clientBasic` | `passport-http` Basic | `Client.findOne({ 'api.basic_key': id })`, `isTrusted` doit valoir true, secret comparé en clair avec `===` | le document client, avec `client.authInfo = { client, scopes: client.scopes, token: { tokenType: 'client' } }` |
| `google` | `passport-google-oauth` OAuth2 | email Google vérifié → `User.findOne({ email })`. L'utilisateur doit exister ; `googleId`, `imageUrl` et `name` sont mis à jour. | utilisateur |
| `OAuth2_Authorization` | `passport-custom` | `grant_type`, `client_id` et `client_secret` dans le corps | client avec `authInfo` |

Échec de `passport.authenticate([...])` sans callback (la plupart des routes « custom ») : 401 `Unauthorized` avec les en-têtes `WWW-Authenticate: Bearer realm="Users"` et `Basic realm="Users"`. Le challenge Basic peut faire apparaître la boîte de dialogue native du navigateur.

### 3.2 Format exact des JWT (`api/src/auth/jwt.js`)

Signature : `jsonwebtoken.sign(payload, process.env.APP_SECRET, { expiresIn })`, algorithme par défaut **HS256**. Payload signé (`createJWT`, l.58-74) : `{ userId, provider, scopes, tokenType, tokenId, shareableId (défaut null), extensions, filter, organisation (défaut null) }`, plus `iat` et `exp`. `payloadDefaults` fixe `provider='native'`, `scopes=[]`, `extensions={}` et `organisation=null`. Une valeur `undefined`, par exemple `filter` sur un token utilisateur, n'apparaît pas dans le JSON.

| `tokenType` | Émis par | `userId` | `tokenId` | `scopes` | `filter` | `organisation` | `extensions` | `shareableId` | Expiration |
|---|---|---|---|---|---|---|---|---|---|
| `user` | `createUserJWT` : login, refresh, Google | id user | id user | `user.scopes` (scopes **site** : `site_admin`, `site_can_create_org`) | absent | `null` | `{}` | `null` | `JWT_ACCESS_TOKEN_EXPIRATION` (1h) |
| `organisation` | `createOrgJWT` : `/auth/jwt/organisation` et refresh | id user | **id organisation** | union des `role.scopes` des `organisationSettings[org].roles`, puis `user.scopes` | `JSON.parse(organisationSettings[org].filter)` (filtre de statements appliqué à toutes les requêtes) | `null` | `{}` | `null` | 1h |
| `dashboard` | `createDashboardJWT` : serveur UI, `renderDashboard` | absent | id dashboard | `['dashboard/shareable/view']` | `{}` | **id organisation du dashboard** | `{ visualisationIds: [...], orgTimezone }` | id du shareable (ou du premier shareable) | 1h, **sans mécanisme de refresh** |
| `user_refresh` | `createUserRefreshJWT` | id user | id user | `['refresh_token_user']` | — | `null` | `{}` | `null` | `JWT_REFRESH_TOKEN_EXPIRATION` (7d) |
| `organisation_refresh` | `createOrgRefreshJWT` | id user | id organisation | `['refresh_token_organisation']` | — | `null` | `{}` | `null` | 7d |
| `client` | pas un JWT : `authInfo` synthétique de `clientBasic` | — | — | `client.scopes` | — | via `client.organisation` | — | — | — |
| `worker` | interne, reconnu par `getOrgFromAuthInfo` | — | id organisation | — | — | — | — | — | — |

`provider` vaut `'native'` ou `'google'`. Le front décode le JWT avec `jwt-decode` et se sert de `tokenType`, `tokenId`, `scopes` et `exp`. Il rafraîchit un token lorsque `exp` est à moins de 3 minutes, en vérifiant toutes les 10 s (`ui/src/redux/modules/auth/refresh.js`).

**Validation à chaque requête** (`verifyToken`, `passport.js:72-106`) : après `jwt.verify`, le serveur **régénère le payload attendu depuis la base** (user, rôles, dashboard, fuseau de l'organisation) et le compare avec Immutable. La comparaison ignore `iat`, `exp`, `filter`, et `shareableId` lorsqu'il est faux. Conséquences :
- un changement de rôles, de scopes ou de widgets du dashboard **invalide immédiatement** les tokens existants ;
- **on ne peut ajouter aucune claim** au payload sans adapter cette comparaison (contrat strict) ;
- l'erreur `Unauthorised` levée lors d'une non-correspondance n'a pas le nom `TokenExpiredError` ni `JsonWebTokenError`. Elle remonte donc comme erreur passport : **500** sur les routes utilisant `passport.authenticate` directement, 401 sur les routes REST et connection. C'est probable d'après le code, à confirmer par un test.

### 3.3 Cookies

| Cookie | Posé par | Attributs | Usage |
|---|---|---|---|
| `refresh_token_user_<userId>` | API (`/auth/jwt/password`) | `HttpOnly`, `SameSite=Strict`, `Path=/api/auth/jwt/refresh`, `Expires` et `Max-Age` = 7d, `Secure` seulement si `req.protocol==='https'` (jamais derrière un proxy sans `trust proxy`) | `/auth/jwt/refresh` |
| `refresh_token_organisation_<orgId>` | API (`/auth/jwt/organisation`) | idem | idem |
| `access_token_user_<userId>` | **front** (`js-cookie`, `ui/redux/modules/auth/token.js:116-125`), domaine `COOKIE_DOMAIN` | non HttpOnly | lecture au rechargement, et stratégie `jwt-cookie` (`/downloadlogo/:org`) |
| `access_token_organisation_<orgId>` | **front** | idem | `jwt-cookie` (downloadexport, importpersonaserror) |

Noms définis dans `ui/src/utils/auth.js` (`getCookieName`) et `lib/constants/cookies.js` (`COOKIE_ACCESS_TOKEN='access_token'`).

**Conséquence pour Angular.** Le cookie de refresh a pour chemin `/api/auth/jwt/refresh` et `SameSite=Strict`. CORS est `*` sans `Access-Control-Allow-Credentials`. Le front doit donc appeler l'API **en même origine, sous `/api`**, y compris en développement via un proxy du serveur de dev Angular.

### 3.4 Flux

1. **Login** : `POST /api/auth/jwt/password` avec Basic `email(minuscules):password` → JWT utilisateur (texte) et cookie de refresh.
2. **Choix d'organisation** : `POST /api/auth/jwt/organisation`, Bearer user, corps `{ organisation }` → JWT organisation et cookie de refresh. Toutes les requêtes métier utilisent ensuite le token d'organisation actif ; l'administration du site utilise le token utilisateur.
3. **Refresh** : `POST /api/auth/jwt/refresh` avec le corps `{ tokenType, id }` et le cookie.
4. **Google** : popup sur `/api/auth/jwt/google`, callback, puis redirection vers `/api/auth/jwt/success?access_token=…` ; le front lit le token dans l'URL du popup. Aucun refresh token n'est émis.
5. **Logout** : côté client uniquement.
6. **Client API** : Basic `basic_key:basic_secret` sur toutes les routes qui acceptent `clientBasic`.
7. **OAuth2 client_credentials** : `/oauth2/token`, pour le service xAPI.

### 3.5 Scopes (`lib/constants/scopes.js`, `lib/constants/orgScopes.js`)

**Scopes site** (champ `user.scopes`) :

| Scope | Libellé |
|---|---|
| `site_admin` | Site Administrator (contourne la plupart des filtres ; sans organisation dans le token, accès à toutes les organisations) |
| `site_can_create_org` | Can create organisation |

**Scopes de rôle d'organisation** (`role.scopes`) :

| Constante | Valeur | Présent dans la liste `orgScopes` |
|---|---|---|
| ALL | `all` (Organisation Administrator) | oui |
| OBSERVER | `observer` (`USER_SCOPES`) | non (présent dans `USER_SCOPES` uniquement) |
| VIEW_PUBLIC_DASHBOARDS / EDIT_PUBLIC_DASHBOARDS | `org/public/dashboard/view` / `edit` | oui |
| VIEW_ALL_DASHBOARDS / EDIT_ALL_DASHBOARDS | `org/all/dashboard/view` / `edit` | oui |
| VIEW_PUBLIC_VISUALISATIONS / EDIT_PUBLIC_VISUALISATIONS | `org/public/visualisation/view` / `edit` | oui |
| VIEW_ALL_VISUALISATIONS / EDIT_ALL_VISUALISATIONS | `org/all/visualisation/view` / `edit` | oui |
| VIEW_PUBLIC_JOURNEYS … EDIT_ALL_JOURNEYS | `org/{public,all}/journey/{view,edit}` | oui (aucun modèle Journey dans ce dépôt) |
| VIEW_PUBLIC_STATEMENTFORWARDING … EDIT_ALL_STATEMENTFORWARDING | `org/{public,all}/statementForwarding/{view,edit}` | oui |
| VIEW_ALL_QUERIES / EDIT_ALL_QUERIES | `org/all/query/view` / `edit` | oui |
| VIEW_PUBLIC_QUERIES / EDIT_PUBLIC_QUERIES | `org/public/query/view` / `edit` | **non**, mais utilisés par les filtres |
| VIEW_ALL_EXPORTS / EDIT_ALL_EXPORTS | `org/all/export/view` / `edit` | oui |
| VIEW_PUBLIC_EXPORTS / EDIT_PUBLIC_EXPORTS | `org/public/export/view` / `edit` | **non** |
| VIEW_ALL_DOWNLOADS / EDIT_ALL_DOWNLOADS | `org/all/download/view` / `edit` | oui |
| VIEW_PUBLIC_DOWNLOADS / EDIT_PUBLIC_DOWNLOADS | `org/public/download/view` / `edit` | **non** |
| MANAGE_ALL_PERSONAS | `org/all/persona/manage` | oui |
| MANAGE_ALL_STORES | `org/all/store/manage` | oui |
| MANAGE_ALL_USERS | `org/all/user/manage` | oui |
| MANAGE_ALL_CLIENTS | `org/all/client/manage` | oui |
| MANAGE_ALL_ROLES | `org/all/role/manage` | oui |
| MANAGE_ALL_ORGANISATIONS | `org/all/organisation/manage` | **commenté** dans la liste (l.112 et 176), mais utilisé par le filtre organisation |

Les libellés des groupes de scopes sont dans `roleGroupNames`. Les dépendances entre scopes (`edit` implique `view`, `all` implique `public`) sont calculées par `lib/helpers/scopes.js`.

**Scopes de client** (`CLIENT_SCOPES` = `API_SCOPES` + `XAPI_SCOPES` ; enum de `client.scopes`) :

| Scope | Libellé |
|---|---|
| `all` | API All |
| `statements/delete` | Delete statements (not covered by All scope) |
| `xapi/all` | All (xAPI) |
| `xapi/read` | Read all |
| `statements/read` | Read all statements |
| `statements/write` | Write statements (must be used with a read scope) |
| `statements/read/mine` | Read my statements (filtre `client: <clientId>`) |
| `state` | Access state |
| `profile` | Access profiles |

`getXapiScopes()` tente d'omettre `statements/delete` de `XAPI_SCOPES`, où il ne figure pas : c'est un no-op.

**Scope de dashboard** : `dashboard/shareable/view`.

**Scopes réservés à Jisc/UDD** (`lib/services/auth/modelFilters/jisc.js`, non branché sur `getScopeFilter`) : `student_app`, `tribal_insight`, `lap`, `ssp`, `opendash`, `udd/read`.

Le plugin `readScopes`/`writeScopes` (`lib/models/plugins/scopeChecks.js`) et `checkReadScopes`/`checkWriteScopes` (`lib/constants/auth.js:224-244`) ne sont **plus utilisés par aucune route** (code mort).

### 3.6 Filtres de modèles par scope (`lib/services/auth`)

Chaîne commune `getModelsFilter` (`filters/utils/getModelsFilter.js`). Les filtres sont évalués dans l'ordre ; le premier qui renvoie une valeur gagne :

1. `checkOrganisationExpirery` : organisation expirée → 403, sauf `site_admin`.
2. `getSiteAdminFilter` : `site_admin` → `{organisation: orgId}`, ou `{}` sans organisation.
3. `checkAllowedTokenType` : par défaut `['organisation','client']`, sinon 403.
4. `checkAllScope` : `all` → `{organisation}`.
5. Filtre spécifique au modèle.

`getOrgFilter` renvoie `{ organisation: ObjectId(orgId) }`. L'organisation (`getOrgFromAuthInfo`) vient de `token.tokenId` pour un token organisation ou worker, sinon de `token.organisationId`, `client.organisation` ou `token.organisation` (token dashboard).

| Modèle(s) | Type de filtre | Lecture (view) | Écriture (create, edit, delete) |
|---|---|---|---|
| dashboard | shareable + cas dashboard ; tokens autorisés : org, dashboard, client | `view/edit_all` → org ; `view/edit_public` → `isPublic` ou propriétaire ; sinon propriétaire (`owner=userId`) ; client sans scope → 403 ; token dashboard → `{_id: dashboardId}` | `edit_all` → org ; `edit_public` → public ou propriétaire ; sinon propriétaire. Token dashboard → 403. |
| visualisation | idem, token dashboard → `{_id ∈ widgets du dashboard}` | idem | idem |
| export, download, query, statementforwarding | shareable | idem (scopes respectifs) | idem |
| client | admin | `org/all/client/manage` → org | idem |
| role | admin | `role/manage` ou `user/manage` → org | `role/manage` → org |
| lrs | global | **tout token organisation** → org ; client → `store/manage` requis | `store/manage` → org |
| persona, personaidentifier, personaattribute, personasimport, importcsv | global (`persona/manage`) | tout token organisation | `persona/manage` |
| querybuildercache, querybuildercachevalue | global (`all`) | tout token organisation | `all` |
| statement (`modelFilters/statement.js`) | spécifique | token user → 403 ; dashboard → autorisé seulement si `allowDashboardAccess` (agrégations) ; organisation → `token.filter` (parsé) + org ; client → + `lrs_id`, et + `client` si `statements/read/mine` est le seul scope de lecture | create et edit : `xapi/all` ou `statements/write` (**`all` ne suffit pas**) ; delete : `statements/delete` |
| user (`modelFilters/user.js`) | spécifique | `site_admin` ou `all` → `{organisations: org}` (ou `{}`) ; token user → `{_id: self}` ; token organisation → organisations ; client sans `all` → 403 | create : `user/manage` ; edit : `user/manage` → org, sinon soi-même ; delete : 403 sans `all` ou `site_admin` |
| organisation (`modelFilters/organisation.js`) | spécifique | `site_admin` → `{}` ; user ou organisation → `_id ∈ user.organisations` ; client avec `all` → son organisation | create : `site_can_create_org` requis si `RESTRICT_CREATE_ORGANISATION`, plus un token organisation avec `all` ou `organisation/manage` ; edit et delete : organisations pour lesquelles l'utilisateur a un rôle `all` |
| batchdelete | spécifique | `ENABLE_STATEMENT_DELETION` et `statements/delete` requis → `{organisation}` | idem |
| sitesettings | aucun | `{}` | `{}` |
| stream, personasimporttemplate | — | **Error → 500** | — |

**Sélection de champs** (`lib/services/auth/selects/models/user.js`) : seul le modèle User en a une.
- `SELECT` (par défaut) : `_id`, `email`, `name`, `organisations`.
- `MANAGER_SELECT` (`site_admin`, `all`, `org/all/user/manage`) : en plus `ownerOrganisation`, `organisationSettings`, `ownerOrganisationSettings`, `scopes`, `createdAt`, `updatedAt`, `verified`.

Le paramètre `?project=` de `/connection/user` est intersecté avec cette sélection.

### 3.7 Rôles

Modèle `lib/models/role.js` : `{ title, description, owner_id, organisation, scopes: [String] }`, sans enum. Les rôles sont rattachés à l'utilisateur dans `user.organisationSettings[].roles`. Le `filter` (JSON en chaîne) de chaque `organisationSettings` est copié dans la claim `filter` du token organisation.

### 3.8 Dashboards partagés

- Le shareable (`lib/models/dashboard.js:31-56`) contient `title`, `filter`, `timezone`, `visibility` (`NOWHERE`, `ANYWHERE`, `VALID_DOMAINS`), `validDomains`, `filterMode` (`OFF`, `ANY`, `JWT_SECURED`), `filterRequired` et `filterJwtSecret`.
- Agrégation avec un token dashboard (`lib/services/statements/aggregate.js` et `utils/checkDashboardAuth.js`) :
  - le pipeline doit correspondre exactement à l'un des pipelines générés (`pipelinesFromQueries`) depuis les visualisations du dashboard, combinés avec `shareable.filter` ; sinon 403 `The query requested was unauthorized` ;
  - en mode `ANY`, le serveur retire avant comparaison un éventuel troisième élément ajouté par l'embarquement dans `pipeline[1].$match.$and` ;
  - en mode `JWT_SECURED`, cet élément `pipeline[1].$match.$and[2]` doit être un **JWT signé avec `filterJwtSecret`** ; le serveur le décode et le substitue. Si `filterRequired` est vrai et que l'élément manque → 403.
- **Fuite** : avec un token dashboard, `GET /v2/dashboard` (filtre `{_id}`) renvoie le document complet, **y compris `shareable[].filterJwtSecret`** et les autres shareables. Le secret permettant de forger des filtres se retrouve ainsi exposé au public.

---

## 4. Formats de réponses, erreurs, pagination et filtres

### 4.1 Erreurs

**Routes « custom »** (`catchErrors` puis `handleRequestError`, `api/src/controllers/utils/handleRequestError.js`) : JSON `{ errorId: <uuid>, message }`.

| Erreur | Statut |
|---|---|
| `NotFoundError`, `PersonaNoModelWithId`, `NoModel` | 404 |
| `Unauthorised` | 401 (message `Unauthorised`) |
| `NoAccessError` | 403 (`Priviliges not sufficient for this operation`) |
| `UnauthorisedQueryError` | 403 (`The query requested was unauthorized`) |
| `ClientError` et dérivées (`DuplicateCsvHeadersError`, `EmptyCsvError`, `InvalidRecalc`), `PersonaConflict` (`This model already exists`), `PersonaHasIdentsError` | 400 |
| `AlreadyProcessingError` | 409 |
| `RequestAppAccessError` | 500 |
| rulr `Warnings` / `Warning` | 400, `{ errorId, messages: [...] }` ou `{ errorId, message }` |
| autre | 500 `{ errorId, message }`, plus `stack` si `LOG_MIN_LEVEL` vaut `debug` ou `silly` |

Les classes d'erreur sont dans `lib/errors/*.js`, toutes héritant de `BaseError`, qui **n'étend pas `Error`**. Le nom de classe est vide pour les classes anonymes (`NoAccessError`, `NotFoundError`, `Unauthorised`…). `api/src/utils/errors/{ModelNotFoundError,UnauthorizedQueryError}.js` sont inutilisés.

**Autres formats d'erreur :**
- `api/src/utils/responses.js` (`/app/version`, `/indexes`) : erreur → `res.status(code).send(message string)`.
- REST erm : `res.send(err)` avec l'objet erreur Mongoose ou erm brut ; statut = `err.statusCode` s'il existe (erm, à vérifier : 404 not found, 400 validation). Sinon le statut par défaut s'applique, à valider par test. Le preMiddleware de scope passe par `handleRequestError` (403 ou 500 JSON).
- Échec d'authentification : 401 texte `Unauthorized`, ou statuts et messages en texte brut (`User does not have access…`, `Cannot create user in a different organisation`, `Invalid organisations array`, `Must have an email…`, `API does not allow bulk deletions`, `Statement deletions not enabled…`, `No ID sent`).
- 404 de route inexistante : HTML Express par défaut.

### 4.2 Succès

| Type | Format |
|---|---|
| Tokens | `text/plain` |
| Agrégations | tableau JSON écrit à la main (`res.write`) |
| Comptes | `{ count }` |
| Personas | entités avec `id` renommé en `_id` (`replaceIds.js`) |
| Fichiers | flux avec le `Content-Type` du fichier |
| Logo | chaîne contenant le chemin |
| Statements (agrégations et connection) | `statement` passé par `mapDot` : décodage des clés encodées `&46;` → `.` |

### 4.3 Conventions de query

**Tous les objets passent en JSON sérialisé dans la query string** : `filter`, `sort`, `hint`, `project`, `pipeline`, `pipelines`, `query`.

Opérateurs étendus convertis par `lib/helpers/parseQuery.js` :
- `{ "$oid": "..." }` → ObjectId ;
- `{ "$dte": "ISO" }` → Date ;
- `statement.timestamp` → `timestamp` et `statement.stored` → `stored`, convertis en Date, dans `$match` et `$sort` ;
- `$personaIdent: { key, value }` → `{ $in: [personaIds] }` via les attributs de persona ;
- `$out` supprimé ;
- `$lookup` limité à `personas`, `personaIdentifiers`, `personaAttributes`, `journeys`, `journeyprogresses` et `statements`, chacun préfixé d'un `$match` de scope.

`parseQuery` **avale les erreurs** et renvoie l'objet erreur à la place du filtre (`.catch(err => err)`, l.27).

### 4.4 Pagination connection (`addCRUDFunctions.getConnection`)

- **Curseur** = `base64(JSON.stringify(pick(node, keys(sort))))` (`lib/helpers/cursor.js`, `new Buffer`).
- `after` ou `before` est traduit en `$or` lexicographique sur les clés de tri. Le cast Mongoose ramène les valeurs du curseur vers les types du schéma.
- Taille : `first` vaut **10 par défaut**, puis `limit = first || last || 100`. Comme `first` a une valeur par défaut, **`last` est en pratique ignoré** (bug).
- `hasNextPage` et `hasPreviousPage` sont déduits de la direction et de la présence d'un curseur.
- **Les connections persona et personaIdentifier** utilisent la pagination de persona-service (`CursorDirection`), avec une taille par défaut de 10.

### 4.5 REST erm

Query `query`, `sort`, `skip`, `limit`, `select`, `populate`, `distinct` (erm, à vérifier). **Risque à vérifier** : `select` et `populate` ne sont pas restreints (pas d'options `private`/`protected`). Un `?select=password` sur `/v2/user` pourrait s'ajouter à la sélection de scope.

---

## 5. Tests API existants (suite de non-régression)

48 fichiers `*-test.js` sous `api/src`, environ 238 `it()`. Lancement par `yarn test-api` (mocha-webpack et supertest sur `api/server`, MongoDB et Redis réels). Helpers : `api/src/routes/tests/utils/setup.js` (vide la base, crée l'organisation de test) et `utils/tokens/*` (fabriques de tokens). **`createClientToken.js` crée en fait un token organisation.**

| Fichier ou dossier | Couverture |
|---|---|
| `routes/tests/http-test.js` | Login (200 et format du cookie de refresh : Path, HttpOnly, Expires ≈ 7d ; claims `userId`, `tokenType`, `tokenId`, exp ≈ 1h ; 401 sans cookie) ; `/auth/jwt/organisation` (200, 401) ; `/auth/jwt/refresh` (user, organisation, corps incorrect, cookie absent ou invalide → 401) ; reset password (demande, réinitialisation) ; `/auth/client/info` ; `/statements/aggregate` (Bearer et Basic, décodage `&46;`) ; `GET /v2/organisation` ; `/oauth2/token` (404 en GET, 200, 400 sur `client_id` ou `client_secret` invalide) |
| `routes/tests/scopeFiltering/*` | Filtrage par scope sur : statements (connection, et filtre de token), count, stores (`lrs` : GET, POST, DELETE), users (GET avec champs limités, POST avec fusion d'organisations par client Basic ou site admin), visualisations (GET, POST, DELETE, dont token dashboard), dashboards (token dashboard : GET, POST, DELETE), `downloadExport`, `exportStatements` (matrices owner/public/hors org × scopes), `downloadLogo`, `uploadLogo`, `mergePersonas` |
| `routes/tests/batchDeleteController/*` | initialise (scope `statements/delete`, filtre vide ou absent), terminate, terminate all |
| `routes/tests/personaController/**` | CRUD personas, identifiants (upsert, doublon, suppression bloquée par des statements), attributs (REST `/v2/personaattribute` : GET, POST, PATCH, DELETE, count, connection), merge |
| `routes/userOrganisationSettings/router-test.js`, `routes/userOrganisations/router-test.js` | Matrice site admin / gestionnaire / utilisateur simple |
| `utils/tests/exports-test.js` | `groupStreams`, `streamToCsv` |

Côté `lib` (`yarn test-lib`, 49 fichiers) : `lib/services/auth/tests/modelFilters/*` couvre les filtres de scope de 13 modèles (client, dashboard, download, export, lrs, organisation, persona, query, role, statement, statementForwarding, user, visualisation), plus des tests de modèles (`lib/models/*-test.js`) et de `importPersonas`.

**Non couverts** : routes REST génériques au-delà de quelques modèles, `/connection` avec curseurs `before`/`after`/`last`, `aggregateAsync`, `/v1/statements/aggregate`, `statementmetadata`, `/export` côté HTTP, `uploadpersonas`, `importpersonas`, `uploadpersona`, `importpersonaserror`, `/indexes`, `/app/*`, Google OAuth, `jwt-cookie`, `sitesettings`, invalidation des tokens après changement de rôle, `/requestAppAccess`. La plupart des tests dépendent de `api/auth/jwt` et de la structure exacte des tokens. Pour une réécriture, ces suites supertest sont réutilisables quasiment telles quelles comme tests boîte noire, en remplaçant les fabriques de tokens par des appels HTTP.

---

## 6. Points d'obsolescence (Node LTS récent, Express 5, MongoDB récent)

### 6.1 Runtime et build

| Point | Où | Impact |
|---|---|---|
| Node 10 | `.nvmrc`, `.circleci/config.yml:6` | à passer en Node 22/24 LTS |
| Babel 6 (`babel-core`, `babel-preset-env`, `stage-0`, `react-optimize`, `transform-runtime`), `babel-polyfill`, `babel-register` | `package.json` devDeps, `.babelrc`, `server.babel` | incompatibles avec la syntaxe récente : migrer vers Babel 7+, ou mieux TypeScript/ESM natif |
| Webpack 3, `hard-source-webpack-plugin`, `UglifyJsPlugin`, `CommonsChunkPlugin`, `babel-loader` 6, `mocha-webpack` 0.7 | `lib/tools/getWebpackConfig.js` | Le hash md4 de webpack ≤ 4 échoue sous OpenSSL 3 (Node ≥ 17 : `ERR_OSSL_EVP_UNSUPPORTED`). Le bundling serveur avec la config du front n'aura plus de raison d'être. |
| Bannière (dotenv 2, newrelic 4.7, source-map-support 0.4) | `getWebpackConfig.js:62-75`, `lib/tools/newrelicConfig.js` | L'agent `newrelic` récent (≥ 11/12) exige Node ≥ 18 ; utiliser `node -r newrelic` ou `--import`. `source-map-support` devient inutile (`--enable-source-maps`). |
| pm2 avec `--max-old-space-size=256` | `pm2/all.json` | trop bas pour une version récente de Node et de Mongoose |
| Annotations Flow dans `lib/helpers/cursor.js:1,5` et `new Buffer` | `cursor.js:2,6`, `lib/helpers/statementForwarding.js:15` | `new Buffer` est déprécié (DEP0005) → `Buffer.from` |
| Code mort | dépendance `restify` ^4 (inutilisée), `lib/connections/multer.js` (`multer` importé mais jamais utilisé : les uploads passent par `multiparty`), modèles `refreshToken.js` et `accessToken.js` inutilisés, `api/src/utils/url.js`, `api/src/utils/errors/*`, `checkReadScopes`/`checkWriteScopes`, `scopeChecks` | à supprimer |
| Dépendances du backend vers `ui/` | `api/src/auth/passport.js:17`, `lib/services/statements/utils/checkDashboardAuth.js:14`, `cli/src/seed/index.js:4` | à extraire en librairie partagée avant de supprimer `ui/` |

### 6.2 Express 4 vers 5

| Point | Où | Impact |
|---|---|---|
| `app.options('*', …)` | `api/src/server.js:18` | path-to-regexp v8 refuse `*` : utiliser `/{*splat}` (ou `cors()` global) |
| `res.send(body, status)` | `HttpRoutes.js:377,380` | signature supprimée en Express 5 : utiliser `res.status(s).send(b)` |
| Chemins `:id.csv`, `:download.csv`, route vide `''` | `lib/constants/routes.js:25,29`, `HttpRoutes.js:76` | à valider avec path-to-regexp v8 |
| `body-parser` séparé | `server.js:20-21` | utiliser `express.json()` ; en Express 5, `req.body` est `undefined` sans parseur (code tel que `req.body.email` dans `lib/constants/auth.js:117`, `AuthController.js:46,82`) |
| `req.query` en lecture seule et parseur `simple` par défaut | erm v3 manipule `req.query` | à vérifier ; l'API elle-même n'utilise que des chaînes JSON |
| Rejets de promesses désormais gérés par Express 5 | `catchErrors` | simplification possible |
| `res.set('X-Frame-Options', null)` | `ui/src/controllers/renderDashboard.js:81` | à reprendre dans le futur endpoint |
| `express-restify-mongoose` 3.2.1 | `HttpRoutes.js:3,307-400`, `lib/constants/auth.js:288-343` | Bloquant : compatible Express 4 et Mongoose ≤ 5 seulement. Les versions récentes ont des options, hooks et routes différents (mise à jour POST et PUT `/:id`, `findOneAndUpdate`, `contextFilter`, `onError`). Le front actuel **utilise `POST /v2/<m>/:id` pour les mises à jour** (`LLApiClient.postModel`). Réécrire des contrôleurs explicites est recommandé. |

### 6.3 MongoDB et Mongoose

| Point | Où | Impact |
|---|---|---|
| Mongoose 5.4 (driver 3.x) et `mongodb` ^2.1.4 en dépendance directe | `package.json` | Un MongoDB récent (7/8) exige le driver 6.x, donc Mongoose 8. |
| `mongoose.set('useNewUrlParser' \| 'useFindAndModify' \| 'useCreateIndex')`, options `poolSize` et `promiseLibrary`, `mongoose.Promise = bluebird` | `lib/connections/mongoose.js:8-11,22,27` | supprimés en Mongoose 6+ (`maxPoolSize`) |
| `mongoose.Types.ObjectId(x)` sans `new` | 26 occurrences, par exemple `lib/services/auth/filters/getOrgFilter.js:14`, `modelFilters/user.js:16,25`, `modelFilters/statement.js:50,64`, `modelFilters/dashboard.js:38`, `modelFilters/visualisation.js:44,52`, `getPrivateOrgFilter.js:15`, `filterByOrg.js:13`, `convert$oid.js:9`, `BatchDeleteController.js:80`, `StatementMetadataController.js:23,49`, `ImportPersonasController.js:68`, `getPersonaFilter.js:12`, `exportStatements.js:47`, `lib/services/persona/*` | lève `TypeError` avec bson 5+ / Mongoose 7+. `objectId(null)` produit aujourd'hui un ObjectId aléatoire (`getOrgFilter`). |
| Callbacks Mongoose (`findOne(q, cb)`, `save(cb)`, `create(doc, cb)`) | `passport.js:140,181,216,231`, `AuthController.js:47,58,89-123,314`, `lib/models/user.js:310,447`, `lib/models/organisation.js:247` | supprimés en Mongoose 7 |
| `Aggregate.cursor({batchSize}).exec()` et `query.options.maxTimeMS` | `lib/models/statement.js:113-126` | API modifiée en Mongoose 6 (`cursor()` renvoie directement le curseur) |
| `Model.collection.find(filter, {}, { maxTimeMS })` (signature du driver 2.x) | `lib/models/plugins/addCRUDFunctions.js:75` | driver 4+ : `find(filter, options)` |
| `mongoose-timestamp`, `mongoose-findorcreate` | modèles | non maintenus : utiliser `timestamps: true` |
| `@learninglocker/persona-service` ^1.7 | `lib/connections/personaService.js` | possède son propre MongoClient et son propre driver ; à mettre à jour ou réinternaliser pour MongoDB 7/8 |

### 6.4 Authentification et sécurité

| Point | Où | Impact |
|---|---|---|
| `passport` 0.4, `passport-http` 0.3, `passport-http-bearer`, `passport-custom` | `api/src/auth/passport.js` | Passport 0.6/0.7 fonctionne en mode sans session ; à moderniser. Le Bearer en query (`?access_token`) devrait être désactivé hors flux Google. |
| `passport-google-oauth` 2 et scope `https://www.googleapis.com/auth/plus.login` | `lib/constants/auth.js:21` | **API Google+ arrêtée en 2019** : passer à `passport-google-oauth20` avec les scopes `profile` et `email`. Le token est passé dans l'URL de redirection (`AuthController.js:269`) et aucun refresh n'est émis. |
| `GOOGLE_ENABLED` testé comme chaîne | `HttpRoutes.js:141`, `passport.js:199` | `"false"` est truthy |
| `jsonwebtoken` 8, promisifié par bluebird, `verify` sans `algorithms` | `jwt.js:19`, `passport.js:27,74`, `AuthController.js:207` | La v9 change les valeurs par défaut ; épingler `algorithms: ['HS256']`. |
| `helmet` 2, `compression`, `morgan` | uniquement `ui/src/server.js` | à ajouter **dans l'API** (helmet 8, logs d'accès) quand le serveur UI disparaîtra |
| CORS `origin: '*'` | `server.js:15` | à restreindre |
| `trust proxy` absent | `server.js` | cookie de refresh jamais `Secure` |
| `multiparty` 4 (uploads), `clamscan` 0.8 | `api/src/controllers/utils/getFile*.js`, `lib/services/files/clamscan.js` | utiliser `multer` 2 ou `busboy` |
| Secrets clients stockés en clair et comparés avec `===` | `passport.js:192`, `lib/models/client.js:30-33` | contrat avec xapi-service ; envisager `timingSafeEqual` |

### 6.5 Autres dépendances utilisées par le chemin de l'API

| Dépendance | Version actuelle | Remarque |
|---|---|---|
| `bluebird` | — | `Promise.props`, `Promise.any`, `promisify`, `delay` : remplaçables par les promesses natives |
| `boolean` | ^0.1 | l'export a changé en v3 |
| `uuid` | ^2 | remplaçable par `crypto.randomUUID` |
| `git-rev` | — | nécessite git au runtime |
| `immutable` | 3 | comparaison des tokens dans `passport.js:84-90`, `checkDashboardAuth.js` |
| `moment` | — | en mode maintenance |
| `highland`, `fast-csv` 3, `async` 2 | — | exports |
| `ioredis` / `redis` | 4 / 2 | — |
| `nodemailer` | 2 | — |
| `aws-sdk` | v2 | en fin de vie (EOL) |
| `pkgcloud`, `@google-cloud/storage` 1, `@azure/storage-blob` 10 | — | stockage de fichiers |
| `http-status`, `ms`, `html-to-text` 2 | — | — |
| Côté front uniquement | — | `popsicle` 3, `popsicle-basic-auth`, `js-cookie`, `jwt-decode` |
| Outillage de test | — | `mocha` 2, `chai` 3, `supertest` 1, `nock` 9 |

---

## 7. Anomalies et risques relevés (pour la documentation et la refonte)

1. **Fuite du hash de mot de passe** dans la réponse de `POST /auth/resetpassword/reset` (`AuthController.js:122`).
2. **`/v2/sitesettings` ouvert en lecture et en écriture** à tout principal authentifié (`getScopeFilter.js`, cas `sitesettings` → `{}`).
3. **`filterJwtSecret` exposé** aux porteurs d'un token dashboard via `GET /v2/dashboard`.
4. **Suppression en masse possible** via `DELETE /v2/personaattribute` (`HttpRoutes.js:390-392`).
5. `/v2/stream`, `/v2/personasimporttemplate` et `/connection/personasimporttemplate` renvoient systématiquement 500.
6. `/auth/jwt/organisation` et le refresh organisation ne revérifient pas l'appartenance à l'organisation à chaque requête. `verifyToken` régénère le payload sans contrôler l'appartenance ; un utilisateur retiré conserve un accès en lecture aux modèles « globaux » (stores, users, personas, statements) tant que son refresh token est valide (7 jours). C'est une déduction du code, à confirmer par un test.
7. **À vérifier : modification du mot de passe d'un autre utilisateur.** `preUpdate` de User détermine « se modifier soi-même » à partir de `req.body._id`, et non de `req.params.id`. Combiné aux scopes `all` ou `user/manage`, un utilisateur pourrait changer le mot de passe d'un autre membre de l'organisation, selon le traitement de `_id` par erm.
8. Statuts incohérents : 401 ou 500 pour un token « non vérifié », selon la route.
9. Le paramètre `last` de connection est ignoré ; `parseQuery` avale ses erreurs.
10. Un token Google sans refresh et un token dashboard sans refresh expirent au bout d'1 h.
11. `/assignpersona` et `/createpersonafromidentifier` sont appelés par le front mais n'existent pas.
12. `checkOrganisationExpirery` n'est pas appliqué aux filtres statement, user, organisation et batchDelete.

### Fichiers clés

**API :**
- `api/src/server.js`
- `api/build.js`
- `api/src/routes/HttpRoutes.js`
- `api/src/routes/personas/personaRESTHandler.js`
- `api/src/routes/personas/personaIdentifierRESTHandler.js`
- `api/src/routes/userOrganisations/router.js`
- `api/src/routes/userOrganisationSettings/router.js`
- `api/src/auth/passport.js`
- `api/src/auth/jwt.js`
- `api/src/controllers/*.js`
- `api/src/controllers/utils/handleRequestError.js`

**lib :**
- `lib/constants/routes.js`
- `lib/constants/auth.js`
- `lib/constants/scopes.js`
- `lib/constants/orgScopes.js`
- `lib/services/auth/filters/getScopeFilter.js`
- `lib/services/auth/filters/utils/getModelsFilter.js`
- `lib/services/auth/modelFilters/*.js`
- `lib/models/plugins/addCRUDFunctions.js`
- `lib/helpers/parseQuery.js`
- `lib/services/statements/aggregate.js`
- `lib/services/statements/utils/checkDashboardAuth.js`

**Côté UI, mais faisant partie du contrat :**
- `ui/src/utils/LLApiClient.js`
- `ui/src/utils/auth.js`
- `ui/src/redux/modules/auth/*.js`
- `ui/src/controllers/renderDashboard.js`
- `ui/src/controllers/renderApp.js`
- `ui/src/server.js`
