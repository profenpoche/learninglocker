# 02. Couche données : MongoDB, Redis, fichiers

> [Index de la documentation](README.md) · État du code : commit `5fec948a` (novembre 2021).

Les dépendances ne sont pas installées dans le dépôt (pas de `node_modules`). Le comportement des paquets `@learninglocker/persona-service@1.7.1`, `@learninglocker/xapi-statements@7.8.0` et `mongoose-timestamp@0.5.0` a été lu dans les archives publiées sur npm.

## 0. Versions effectives (d'après `yarn.lock`) et conventions communes

| Élément | Version | Rôle |
|---|---|---|
| Node | 10 (`.nvmrc`) | |
| mongoose | 5.8.1 | ORM principal. Il embarque le driver **mongodb 3.3.5**. |
| mongodb (dépendance directe) | **2.2.36** | Sert seulement à importer `ObjectID` et `MongoError`. |
| @learninglocker/persona-service | 1.7.1 | Utilise son propre `MongoClient`, en **mongodb 2.2.x**. |
| @learninglocker/xapi-statements | 7.8.0 | mongodb 3.4.0. C'est la librairie du service xAPI (projet séparé). Le worker s'en sert aussi. |
| mongoose-timestamp | 0.5.0 | |
| mongoose-findorcreate | 0.1.2 | Appliqué au modèle User. |
| ioredis | 4.28.0 | |
| bull | 3.12.1 | |
| bcryptjs | 2.4.3 | |
| express-restify-mongoose | 3.2.1 | Génère l'API REST `/api/v2/<model>`. |
| CI (`.circleci/config.yml`) | `mongo:4.2-bionic`, `redis:4-alpine` | |

**Conventions qui valent pour tous les modèles**

- **`__v`** : c'est la clé de version par défaut de Mongoose. Elle est présente sur les documents créés par Mongoose. Elle est absente des documents insérés par le driver brut : statements, personas, caches du query builder.
- **`_id` des sous-documents** : chaque élément de tableau de sous-schéma reçoit un `_id`. C'est le cas de `dashboards.widgets[]`, `dashboards.shareable[]`, `users.organisationSettings[]`, `users.resetTokens[]`, `users.passwordHistory[]`, `visualisations.statementContents[]`, `streams.outcomes[]`, `importcsv.customIndexes[]`, `importcsv.matchedIndexes` et `personasImports.importErrors[]`.
  - `UploadSchema` est déclaré avec `_id:false`.
  - **Les `_id` de `shareable[]` apparaissent dans des URL et dans des JWT de partage.** Il faut les conserver.
- **`autoIndex`** reste à sa valeur par défaut (true) : chaque process (api, worker, cli, serveur ui) construit au démarrage tous les index déclarés dans les schémas. Aucun `autoIndex:false` ni `syncIndexes` dans le code.
- **mongoose-timestamp 0.5.0** (`index.js` du paquet npm) :
  - Ajoute `createdAt` et `updatedAt`, tous deux de type `Date`.
  - Sur `pre('save')` : si `createdAt` est vide, `createdAt = updatedAt = new Date`. Sinon, si le document est modifié, `updatedAt = new Date`.
  - Sur `pre('findOneAndUpdate')` : pose `updatedAt` et `$setOnInsert.createdAt`.
  - Sur `pre('update')`, le hook n'agit que si `this.op === 'update'`. **Les `updateOne` et `updateMany` de Mongoose 5 ne mettent donc PAS `updatedAt` à jour.** C'est le comportement historique des données.
  - Ajoute la méthode `touch()`.

## 1. Modèles Mongoose (`lib/models/`)

### 1.1 Plugins (`lib/models/plugins/`)

| Plugin | Fichier | Effet |
|---|---|---|
| `scopeChecks` | `scopeChecks.js` | Statics `readScopeChecks` / `writeScopeChecks`, fondés sur `schema.readScopes` / `schema.writeScopes`. Le scope `site_admin` passe toujours. Rien n'est stocké. |
| `filterByOrg` | `filterByOrg.js` | Statics `getOrgFilterFromAuth` (ajoute `organisation: ObjectId`) et `filterByAuth`. |
| `addCRUDFunctions` | `addCRUDFunctions.js` | Statics `getConnection` (pagination par curseur base64 sur les clés de tri, `limit+1`, `maxTimeMS` = env `MAX_TIME_MS`, défaut 0), `getCount`, `getById`, `getIndexes`, `updateById`, `createFromRecord`, `deleteById`. |
| `auditRemove` | `auditRemove.js` | Crée le modèle **`Audit` → collection `audits`** (pluralisation Mongoose) et la static `auditRemove(doc, user)`. |
| `softDelete` | `softDelete.js` | Défini (`deleted`, `DELETED_AT`, index `{deleted:-1}` et `{DELETED_AT:1, deleted:1}`) mais **appliqué à aucun modèle**. |
| `mongoose-findorcreate` | npm | Static `findOrCreate`, sur User uniquement. |

Précisions sur `addCRUDFunctions` :
- `getCount` a un cas particulier pour les statements (l.270-285). Si le filtre se limite à `{organisation}`, il renvoie la **somme de `lrs.statementCount`**. Sinon il fait un `countDocuments`.

Précisions sur `auditRemove` :
- Le document écrit dans `audits` a la forme `{id, name, model, userId, clientId, auditType:'REMOVED', organisation, metadata, createdAt, updatedAt}`.
- `metadata` peut contenir `statementCount`, `email`, `organisations`, `lrs_id`, et **`api` pour un client**, c'est-à-dire `basic_key` et `basic_secret` en clair.
- La fonction est appelée par le hook `preDelete` REST, dans `lib/constants/auth.js:253`.

### 1.2 Inventaire des modèles et collections

| Modèle | Collection exacte | Fichier | Plugins | Hooks / statics notables |
|---|---|---|---|---|
| Audit | `audits` | plugins/auditRemove.js | timestamps | — |
| BatchDelete | `batchDelete` | batchDelete.js | timestamps, scopeChecks, filterByOrg, CRUD | Helpers de fenêtre horaire (`inWindow`, `nextRunAtDateTime`) |
| Client | `client` | client.js | timestamps, scopeChecks, filterByOrg, CRUD, auditRemove('Client') | pre save : génère la clé et le secret |
| Dashboard | `dashboards` | dashboard.js | timestamps, scopeChecks, filterByOrg, CRUD | pre save : réinitialise les ids de widgets en double. Static `filterByAuth` (token dashboard). |
| Download | `downloads` | download.js | scopeChecks, filterByOrg, CRUD | — |
| Export | `exports` | export.js | scopeChecks, filterByOrg, CRUD | — |
| ImportCsv | `importcsv` | importcsv.js | timestamps, scopeChecks, filterByOrg, CRUD | Héritage v1 |
| ImportData | `importdata` | importdata.js | timestamps, scopeChecks, filterByOrg | Orphelin : enregistré via `lib/models/index.js` |
| ImportPersonasLock | `importPersonasLock` | importPersonasLock.js | timestamps | — |
| Lrs | `lrs` | lrs.js | filterByOrg, timestamps, CRUD, scopeChecks, auditRemove('LRS') | pre save `isNew` : crée un Client. Statics `updateStatementCount`, `decrementStatementCount`. |
| OAuthToken | `oAuthTokens` | oAuthToken.js | aucun | — |
| AccessToken | `accessToken` | accessToken.js | aucun (`strict:false`) | **Jamais importé** (code mort) |
| RefreshToken | `refreshToken` | refreshToken.js | aucun | **Jamais importé** (code mort) |
| Organisation | `organisations` | organisation.js | timestamps, scopeChecks, CRUD, filterByOrg, auditRemove('Organisation') | post init, pre save, post remove (voir 1.3) |
| OrgUsageStats | `orgUsageStats` | orgUsageStats.js | aucun | — |
| PersonaAttribute | `personaAttributes` (**partagée avec persona-service**) | personaAttribute.js | filterByOrg, timestamps, CRUD, scopeChecks | pre save : `updateQueryBuilderCache` (sans await) |
| PersonasImport | `personasImports` | personasImport.js | timestamps, scopeChecks, filterByOrg, CRUD | Neuf validateurs sur `structure` |
| PersonasImportTemplate | `personasImportTemplates` | personasImportTemplate.js | timestamps, scopeChecks, filterByOrg, CRUD | — |
| Query | `queries` | query.js | scopeChecks, filterByOrg, CRUD | Getters `JSON.parse` |
| QueryBuilderCache | `queryBuilderCaches` | querybuildercache.js | timestamps, scopeChecks, filterByOrg, CRUD | — |
| QueryBuilderCacheValue | `queryBuilderCacheValues` | querybuildercachevalue.js | timestamps, scopeChecks, filterByOrg, CRUD | — |
| Role | `role` | role.js | filterByOrg, timestamps, CRUD, scopeChecks | pre remove (l.59) : refuse si c'est le dernier rôle de l'org ou si un utilisateur y est affecté |
| SiteSettings | `siteSettings` | siteSettings.js | timestamps | Un seul document, `_id` fixe `111111111111111111111111` (`lib/constants/siteSettings.js`) |
| Statement | `statements` | statement.js | scopeChecks, filterByOrg, CRUD | post remove (l.97) : `Lrs.decrementStatementCount`. Statics `aggregateByAuth`, `aggregateAsync`, `postFetchMap`. |
| StatementSample | `statementSamples` | statementSample.js | même schéma que Statement | Temporaire (orgUsageTracker) |
| StatementOrgSample | `statementOrgSamples` | statementOrgSample.js | même schéma que Statement | Temporaire |
| StatementForwarding | `statementForwarding` | statementForwarding.js | scopeChecks, filterByOrg, CRUD, timestamps | Méthodes `getAuthHeaders`, `getHeaders` |
| Stream | `streams` | stream.js | scopeChecks, filterByOrg | Héritage |
| User | `users` | user.js | findOrCreate, timestamps, CRUD, filterByOrg, auditRemove('User') | post init, pre validate, deux pre save (voir 1.3) |
| Visualisation | `visualisations` | visualisation.js | scopeChecks, timestamps, filterByOrg, CRUD | Static `filterByAuth` |
| Migration | `migrations` | cli/src/migrateMongo/models/migration.js | timestamps | — |
| VisualisationForMigration | `visualisations` | cli/src/commands/migrateVizTypesOfTemplates.js | aucun | Schéma réduit (`type`, `templateId`, `templateStage`) |
| *UploadSchema* | sous-schéma (`_id:false`) | uploadSchema.js | timestamps | Champs `{mime, key, repo, createdAt, updatedAt}` |

### 1.3 Champs par modèle

Abréviations : OID = ObjectId. ts = `createdAt`/`updatedAt` ajoutés par mongoose-timestamp. « idx » signale un index simple déclaré dans le schéma.

#### users (`lib/models/user.js`)

| Champ | Type / défaut / contraintes |
|---|---|
| name | String |
| email | String, lowercase, trim, **index unique** (l.136-151). Un validateur async refuse un email déjà pris. |
| organisations | [OID→Organisation], idx |
| organisationSettings[] | `organisation` OID→Organisation (**required**, idx). `scopes` [String]. `roles` [OID→Role]. `filter` String `'{}'` (requête JSON). `oldFilter` String. `timezone` String. |
| imageUrl | String |
| googleId | String (en clair) |
| password | String, **hash bcrypt** (validateur `validatePassword`, l.92-130) |
| ownerOrganisation | OID→Organisation, idx |
| ownerOrganisationSettings | Copie des réglages de l'org : `LOCKOUT_ENABLED` true, `LOCKOUT_ATTEMPS` 5 (faute de frappe d'origine), `LOCKOUT_SECONDS` 1800, `PASSWORD_HISTORY_CHECK` true, `PASSWORD_HISTORY_TOTAL` 3, `PASSWORD_MIN_LENGTH` 8, `PASSWORD_REQUIRE_ALPHA` true, **`PASSWORD_REQUIRE_NUMBER` true** (alors que le défaut côté Organisation est false), `PASSWORD_USE_CUSTOM_REGEX` false, `PASSWORD_CUSTOM_REGEX` null, `PASSWORD_CUSTOM_MESSAGE` null |
| settings.CONFIRM_BEFORE_DELETE | Boolean true |
| scopes | [String] (`site_admin`, `site_can_create_org`) |
| verified | Boolean false |
| resetTokens[] | `{token: String, expires: Date}` |
| passwordHistory | `[{hash: String, date: Date}]`, défaut [] |
| authLastAttempt | Date null |
| authFailedAttempts | Number 0 |
| authLockoutExpiry | Date null |
| hasBeenMigrated | Boolean false |
| ts | |

**Hachage, à reproduire à l'identique :**
- `password` : `bcrypt.hash(password, 8)` avec bcryptjs (l.378). Le format produit est `$2a$08$…`.
  - Le hash est poussé dans `passwordHistory` (`{date, hash}`), tronqué à `PASSWORD_HISTORY_TOTAL` entrées.
  - Un nouveau mot de passe est comparé (`bcrypt.compare`) aux N derniers hash.
  - Un mot de passe vide au save restaure le hash d'origine, lu dans `_original`.
  - La vérification de login est `bcrypt.compare` (`api/src/auth/passport.js:167`). Le verrouillage repose sur `authFailedAttempts` et `authLockoutExpiry` (`api/src/controllers/AuthController.js:160-184`).
- `resetTokens[].token` = **`bcrypt.hash(email, 8)`**, stocké **en clair** (l.238-252).
  - Expiration : 24 h par défaut.
  - Recherche par égalité stricte : `{email, 'resetTokens.token': token, 'resetTokens.expires': {$gt: now}}` (`AuthController.js:89-94`).

**Hooks** :
- post init : `_original = toObject()`.
- pre validate : `checkNewUser`. Si l'email existe déjà, fusionne les organisations dans l'utilisateur existant. Sinon, pose `ownerOrganisation = organisations[0]`, crée un reset token et envoie l'email.
- pre save n°1 : si nouveau, copie `organisation.settings` dans `ownerOrganisationSettings`.
- pre save n°2 : vérification et hachage du mot de passe. `verified = true` si `password` ou `googleId` est présent.

Statics : `getOrgFilterFromAuth` (`{organisations: {$in: [orgId]}}`) et les scope checks.

#### organisations (`lib/models/organisation.js`)

| Champ | Type / défaut |
|---|---|
| name | String |
| logoPath | String (`/api/downloadlogo/{orgId}`) |
| logo | UploadSchema `{mime, key:'logos/{orgId}', repo:FS_REPO, ts}` |
| customColors | [String], défaut [] |
| parent | OID→Organisation |
| owner | OID→User |
| expiration | Date (setter qui mémorise `_oldExpiration`) |
| expirationNotifications.weekBeforeNotificationSent / .expirationNotificationSent | String, enum `EMAIL_NOOP` / `EMAIL_PROCESSING` / `EMAIL_SENT`, défaut `EMAIL_NOOP` |
| usageStats | `RUN_DATETIME` Date, `HAS_CHILDREN` Bool, `OWN_COUNT`, `TOTAL_COUNT`, `OWN_ESTIMATED_BYTES`, `TOTAL_ESTIMATED_BYTES` Number |
| settings | Mêmes clés que `ownerOrganisationSettings`, avec ces écarts : `PASSWORD_REQUIRE_NUMBER` false ; validateurs `LOCKOUT_ATTEMPS ≥ 1`, `LOCKOUT_SECONDS ≥ 5`, `PASSWORD_HISTORY_TOTAL ≥ 1`, `PASSWORD_MIN_LENGTH ≥ 4`, regex valide |
| timezone | String (setter qui mémorise `_oldTimezone`) |
| ts | |

Le validateur de `PASSWORD_HISTORY_TOTAL` teste `LOCKOUT_ENABLED` au lieu de l'historique (bug).

**pre save (l.328-351)** :
1. Si `expiration` change, remet les deux notifications à `EMAIL_NOOP`.
2. Si `timezone` change, appelle `update$dteTimezoneInDB` (`lib/helpers/update$dteTimezoneInDB.js`). Celui-ci réécrit les offsets `$dte` dans :
   - `visualisations.filters`, `axesxQuery`, `axesyQuery` ;
   - `statementForwarding.query` ;
   - `dashboards.shareable[].filter` ;
   - `users.organisationSettings[].filter`.

   Les objets qui ont leur propre `timezone` sont ignorés.
3. Fait `User.updateMany({ownerOrganisation: id}, {ownerOrganisationSettings: settings})`.
4. Si l'org est nouvelle :
   - crée deux rôles, Observer (scopes `org/public/dashboard/view`, `org/public/visualisation/view`, `org/public/journey/view`) et Admin (`['all']`) ;
   - ajoute l'org et `{organisation, roles:[admin]}` au propriétaire.

**post remove (l.353)** : supprime les rôles de l'org et fait un `$pull` sur `users.organisations` et `users.organisationSettings`.

#### client (`lib/models/client.js`)

| Champ | Type / défaut |
|---|---|
| title | String |
| api.basic_key | String, 40 caractères hexadécimaux, **en clair** |
| api.basic_secret | String, 40 caractères hexadécimaux, **en clair** |
| authority | **String JSON**. Getter `JSON.parse`. Validé par `@learninglocker/xapi-validation`. Défaut `'{"objectType":"Agent","name":"New Client","mbox":"mailto:hello@learninglocker.net"}'`. |
| isTrusted | Boolean true |
| organisation | OID→Organisation, idx |
| lrs_id | OID→Lrs, idx |
| scopes | [String], enum = clés de `CLIENT_SCOPES` : `all`, `statements/delete`, `xapi/all`, `xapi/read`, `statements/read`, `statements/write`, `statements/read/mine`, `state`, `profile` |
| ts | |

- Clé et secret sont générés par `crypto.randomBytes(20).toString('hex')` (l.13-18, pre save l.69-75).
- **Le secret n'est pas haché.** Il est comparé en clair, ici (`passport.js:192, 263-266`) comme dans xapi-service, qui fait `findOne({'api.basic_key', 'api.basic_secret'})`.
- Index unique `apiKey_apiSecret`, créé par migration (voir §4).

#### lrs (`lib/models/lrs.js`)

Champs : `title`, `description`, `owner_id` (OID→User), `organisation` (idx), `statementCount` (Number 0), ts.

- `statementCount` est incrémenté par xapi-service (`$inc`).
- `decrementStatementCount` utilise `Model.update` (l.93).

#### oAuthTokens (`lib/models/oAuthToken.js`)

Champs : `clientId` (OID→Client), `accessToken` (String, **uuid v4 en clair**), `createdAt` (Date), `expireAt` (Date, `createdAt` + 3600 s, constante `ACCESS_TOKEN_VALIDITY_PERIOD_SEC`, `lib/constants/auth.js:31`).

- Index **TTL** `{expireAt:1}` avec `expireAfterSeconds:0`, créé par migration.
- Écrit par `AuthController.issueOAuth2AccessToken` (l.296-334). Lu par xapi-service.

#### accessToken / refreshToken (code mort)

- accessToken : `token` (String, idx), `expirationDate`, `user`, `client`, `scopes`.
- refreshToken : `refreshToken`, `expirationDate`, `user`, `client`.
- Les JWT ne sont pas stockés. Ils sont signés avec `APP_SECRET`.

#### role (`lib/models/role.js`)

Champs : `title`, `description`, `owner_id` (OID→User), `organisation` (idx), `scopes` ([String], scopes d'org de `lib/constants/orgScopes.js` plus `all`), ts.

#### dashboards (`lib/models/dashboard.js`)

| Champ | Détail |
|---|---|
| title | String |
| widgets[] | `{_id, title, suggestedStep, visualisation: OID→Visualisation, x:0, y:0, w:4, h:4}` |
| shareable[] | `title` `'~ Shareable'`, `filter` String `'{}'`, `oldFilter` String, `timezone`, `visibility` (enum `NOWHERE`/`ANYWHERE`/`VALID_DOMAINS`, défaut `NOWHERE`), `validDomains` String, `createdAt` (Date), `filterMode` (enum `OFF`/`ANY`/`JWT_SECURED`, défaut `OFF`), `filterRequired` (false), `filterJwtSecret` (String `''`, requis si `JWT_SECURED`, **en clair**, sert à `jwt.verify` dans `lib/services/statements/aggregate.js:55-67`) |
| organisation | OID, idx |
| owner | OID→User, idx |
| isPublic | false |
| hasBeenMigrated | false |
| type | String (`blankDashboard`, `streamStarter`, `gettingStarted`, …) |
| ts | |

- Le défaut de `shareable[].createdAt` est `new Date()` évalué **au chargement du module** (l.39), donc une date figée.
- Champs hérités possibles à la racine avant la migration 20180320 : `filter`, `visibility`, `validDomains`.

#### visualisations (`lib/models/visualisation.js`)

- Chaînes JSON, validées comme objets JSON non-tableaux : `axesgroup`, `axesxValue`, `axesxQuery`, `axesyValue`, `axesyQuery`, `axesvalue`, et chaque élément de `filters` (défaut déclaré `['{$match: {}}']`, qui n'est pas du JSON valide).
- Chaînes libres : `description`, `type`, `axes` (déprécié, JSON), `axesxLabel`, `axesxOperator`, `oldAxesxQuery`, `axesyLabel`, `axesyOperator`, `oldAxesyQuery`, `axesquery`, `axesoperator`.
- `oldFilters` : [String], défaut undefined.
- Booléens : `stacked` (true), `trendLines` (false), `sourceView` (false), `benchmarkingEnabled` (false), `isDonut` (false), `isPublic` (false), `showStats` (true), `statsAtBottom` (true), `hasBeenMigrated` (false).
- `organisation` (idx), `owner` (idx).
- `suggestedStep`, `previewPeriod` (défaut `'LAST_7_DAYS'`), `barChartGroupingLimit` (10), `timezone`, `contextLabel`.
- `statementContents[]` : `{Path, Title, User_Title: OID→Visualisation}`.
- ts.
- Champs hérités supprimés par migration : `templateId`, `templateStage`.

#### queries (`lib/models/query.js`)

Champs : `organisation` (idx), `owner` (idx), `name`, `conditions` (String JSON, getter parse, défaut `'{}'`), `oldConditions` (idem), `isPublic`, `hasBeenMigrated`. Pas de ts.

#### exports (`lib/models/export.js`)

Champs : `organisation` (idx), `name`, `owner` (idx), `projections` ([String], défaut `[defaultProjection]` = JSON de `lib/constants/exports.js`), `type`, `rawMode` (false), `downloads` ([OID→Download]), `isPublic`. Pas de ts.

#### downloads (`lib/models/download.js`)

| Champ | Détail |
|---|---|
| organisation | idx |
| owner | idx |
| isReady | false |
| time | Date |
| name | String |
| url | `/api/organisation/{org}/downloadexport/{id}.csv` |
| upload | UploadSchema `{mime:'text/csv', key:'downloads/…csv', repo}` |
| pipelines | String |
| isPublic | Boolean |

Pas de ts à la racine.

#### statementForwarding (`lib/models/statementForwarding.js`)

| Champ | Détail |
|---|---|
| description | String |
| organisation | idx |
| lrs_id | idx |
| active | Boolean |
| timezone | String |
| configuration.protocol | enum `http`/`https`, défaut `http` |
| configuration.url | Sans schéma ; requis si `active` |
| configuration.authType | enum `no auth`/`token`/`basic auth`, défaut `no auth` |
| configuration.secret | **En clair**, requis si token |
| configuration.basicUsername / basicPassword | **En clair**, requis si basic |
| configuration.maxRetries | Entier 0..10 |
| configuration.headers | **String JSON** (avec liste noire d'en-têtes) |
| owner | idx |
| query | String JSON |
| oldQuery | String |
| hasBeenMigrated, isPublic, fullDocument, sendAttachments | Booléens (false) |
| ts | |

Index composé déclaré : `{organisation:1, timestamp:-1, _id:1}`. **Le champ `timestamp` n'existe pas** (copier-coller).

#### statements (modèle `lib/models/statement.js:38-78`, structure détaillée en §2)

Champs déclarés au schéma :
- `lrs` (Mixed, hérité v1), `organisation`, `lrs_id`, `person: {_id: OID→Persona, display: String}`, `personaIdentifier` (OID) ;
- `active`, `voided`, `timestamp` (Date), `stored` (Date), `refs` (Mixed), `statement` (Mixed) ;
- `client_id` (String, hérité), `client` (OID) ;
- `completedQueues`, `processingQueues` ([String]) ;
- `deadForwardingQueue`, `pendingForwardingQueue`, `completedForwardingQueue` ([OID→StatementForwarding]) ;
- `failedForwardingLog[]` : `{statementForwarding_id, timestamp, message, errorInfo}` ;
- `hash` (String), `metadata` (Mixed).

Index déclaré : `{organisation:1, timestamp:-1, _id:1}`. Pas de ts.

`postFetchMap` décode `&46;` en `.` dans toutes les clés de `statement`.

Le même schéma sert à `statementSamples` et `statementOrgSamples`. L'autoIndex y crée donc le même index, et les collections, dès le démarrage.

#### personaAttributes (côté LL)

Champs : `organisation` (idx), `personaId` (OID→'Persona', idx), `key` (String, **required**), `value` (Mixed, **required**), ts.

#### personasImports

| Champ | Détail |
|---|---|
| title | String |
| owner | idx |
| organisation | idx |
| csvHandle | `personasCsvs/{id}.csv` |
| csvErrorHandle | `personasCsvs/{id}-error.csv` |
| importStage | enum `STAGE_UPLOAD` / `STAGE_CONFIGURE_FIELDS` / `STAGE_PROCESSING` / `STAGE_IMPORTED`, défaut `STAGE_UPLOAD` |
| totalCount | Number |
| processedCount | 0 |
| csvHeaders | [String] |
| importedAt | Défaut `Date(8640000000000000)`, la date maximale représentable |
| importErrors[] | `{row: Number, rowErrors: [String]}` |
| result | `{created: 0, merged: 0}` |
| structure | Mixed, dictionnaire `colonne → {columnName, columnType, relatedColumn, primary, attributeName, useConstant, constant}` |
| ts | |

Index composé : `{organisation:1, updatedAt:-1, _id:1}`.

#### Autres modèles

- **personasImportTemplates** : `name`, `organisation` (idx), `isPublic`, ts.
- **importPersonasLock** : `ifis` ([Mixed], **index unique multikey**), `organisation` (idx), ts. Verrou de 120 s, appliqué par `deleteMany createdAt < now-120s` (`lib/services/importPersonas/establishLock.js`).
- **queryBuilderCaches** : `organisation` (idx), `path` (**[String]**, idx multikey), `searchString`, `valueType`, ts.
  - Index : `{organisation:1, searchString:1}` **unique** et `{organisation:1, path:1, createdAt:-1, _id:1}`.
- **queryBuilderCacheValues** : `organisation`, `path` (**String pointée**, alors que c'est un tableau dans `queryBuilderCaches`), `hash`, `value` (Mixed), `display` (Mixed null), `valueType`, `searchString`, ts.
  - Index : `{organisation:1, path:1, hash:1}` **unique** et `{organisation:1, path:1, updatedAt:-1, _id:1}`.
  - **Calcul du `hash`, à reproduire** (`lib/services/querybuildercache/saveCacheValues.js`) : `JSON.stringify(fullValue).length > 40 ? sha1(JSON.stringify(value)) : JSON.stringify(value)`.
  - Les attributs personas utilisent une variante, basée sur `value` seul (`lib/services/importPersonas/updateQueryBuilderCache.js:39`).
- **siteSettings** : `dontShowRegistration` (false), `batchDeleteWindowUTCHour` (null), `batchDeleteWindowUTCMinutes` (null), `batchDeleteWindowDurationSeconds` (3600), ts.
- **batchDelete** : `client` (idx), `organisation` (idx), `pageSize` (1000), `total`, `deleteCount`, `filter` (String JSON), `processing` (false), `done` (false), ts.
- **importcsv** : `organisation` (idx), `matchedIndexes{usernameIndex, emailIndex, firstnameIndex, lastnameIndex, openIdIndex, nameIndex, homePageIndex}` (tous -1), `customIndexes[{fieldName, index:-1}]`, `owner` (idx), `uploadStatus{inProgress false, totalCount 0, remainingCount 0}`, ts.
- **importdata** : `importModel` (OID→'Import', idx), `data` (Array []), ts.
- **streams** : `organisation` (idx), `hash`, `description`, `outcomes[{description, isActive:true, callback, type}]`, `conditions`.
- **orgUsageStats** : `organisation`, `children[]`, `name`, `date`, `totalPercentage`, `ownCount`, `ownEstimatedBytes`, `totalCount`, `totalEstimatedBytes`.
- **migrations** : `key`, `upFn` (**le code source de `up()` en texte**), `order`, ts.

### 1.4 Relations (refs ObjectId)

- `organisation` (presque partout) → `organisations`.
- `organisations.parent` → `organisations`.
- `organisations.owner`, `lrs.owner_id`, `role.owner_id`, les champs `owner` → `users`.
- `client.lrs_id`, `statements.lrs_id`, `statementForwarding.lrs_id`, `fullActivities.lrs_id` → `lrs`.
- `statements.client`, `oAuthTokens.clientId`, `batchDelete.client` → `client`.
- `users.organisationSettings.roles` → `role`.
- `dashboards.widgets.visualisation` → `visualisations`.
- `exports.downloads` → `downloads`.
- `statements.person._id` et `personaAttributes.personaId` → `personas`.
- `statements.personaIdentifier` → `personaIdentifiers`.
- Les trois files de forwarding de `statements` → `statementForwarding`.

## 2. Collections hors modèle Mongoose et contrat partagé avec xapi-service

### 2.1 `statements`

Les statements sont insérés par xapi-service, via `xapi-statements/dist/repo/modelsRepo/createStatements/mongo.js` (`insertMany`). Le modèle construit vient de `service/storeStatements/postValidationSetup/index.js`.

| Champ | Type | Écrit par | Remarque |
|---|---|---|---|
| `_id` | OID | xapi (driver) | |
| `statement` | Objet | xapi | Statement xAPI complet, tel que retourné : `id` (uuid), `actor`, `verb`, `object`, `result`, `context`, `timestamp` et `stored` en **String ISO**, `authority` (= `client.authority`), `version`, `attachments`. **Les clés d'extensions contenant des points sont encodées `&46;`** (`encodeDotsInStatement`). |
| `organisation`, `lrs_id`, `client` | OID | xapi | Proviennent du client authentifié |
| `hasGeneratedId` | Bool | xapi | Vrai si l'id du statement a été généré par le LRS |
| `person` | `null` à l'insertion, puis `{_id: OID persona, display: String}` | worker LL | |
| `personaIdentifier` | OID | worker LL | `extractPersonasHandler.js`, `asignIdentifierToStatements.js` |
| `active` | Bool true | xapi | |
| `voided` | Bool | xapi | Passe à true via `update(…, {multi:true})` (voidStatements) |
| `timestamp`, `stored` | **Date** | xapi | Les filtres sur `statement.timestamp` / `statement.stored` sont réécrits vers ces champs (`lib/helpers/convertStatementTimestamp.js`) |
| `hash` | String | xapi | `object-hash` sha1 du « preHashStatement ». Sert à la détection de conflit et à l'index unique `org_lrs_hash`. |
| `agents`, `relatedAgents` | [String] | xapi | Identifiants d'acteurs : `mbox`, `homePage|name`, `openid` ou `mbox_sha1sum` (`utils/getActorIdent.js`) |
| `verbs`, `activities`, `relatedActivities`, `registrations` | [String] | xapi | Mis à jour aussi par `setQueriables` (`$addToSet`) pour les refs |
| `metadata` | Objet | xapi | Clés `https://learninglocker&46;net/…` : `result-duration` (`{seconds}`), `sequencing-response`, `numeric-response`, `choice-response`, `matching-response`, `true-false-response`, `likert-response` |
| `priority` | String `MEDIUM` ou `LOW` | xapi | Paramètre `?priority=` du PUT/POST |
| `completedQueues`, `processingQueues` | [String] | worker LL ; `completedQueues` est initialisé par xapi (`[]` ou `?bypassQueues=`) | Noms de files : `STATEMENT_PERSON_QUEUE`, `STATEMENT_QUERYBUILDERCACHE_QUEUE`, `STATEMENT_FORWARDING_QUEUE` |
| `pendingForwardingQueue`, `completedForwardingQueue`, `deadForwardingQueue`, `failedForwardingLog` | | worker LL | `worker/src/handlers/statement/statementForwarding/*` |
| `rev` | Number 1 | migration 20171121 | |
| `refs`, `lrs` (`{_id}`), `client_id` (String) | | Héritage v1 / anciennes versions | |

Les statements n'ont **pas** de `__v`. Leur seule suppression applicative se fait via `batchStatementDeletion` (`deleteMany`, sans décrément de `lrs.statementCount`) ou via un DELETE REST unitaire (hook post remove).

### 2.2 Autres collections partagées ou sans modèle

- **`fullActivities`** : écrite par xapi-service (bulk `upsert`, `repo/modelsRepo/updateFullActivities/mongo.js`).
  - Forme : `{organisation, lrs_id, activityId, name.<lang>, description.<lang>, extensions (points encodés &46;), moreInfo, type}`.
  - Index unique `org_lrs_id_activityId`.
  - LL se contente de créer l'index.
- **`personas`** (persona-service, `mongoModelsRepo`) : `{_id, name, organisation: OID}`. Les données migrées peuvent porter `createdAt` / `updatedAt`.
- **`personaIdentifiers`** : `{_id, organisation, persona: OID, ifi: {key, value}, locked: Bool}`.
  - `key` vaut `mbox`, `mbox_sha1sum`, `openid` ou `account`.
  - Pour `account`, la valeur est **toujours ordonnée `{homePage, name}`**. L'ordre compte, car l'index unique `{organisation, ifi}` compare l'objet.
- **`personaAttributes`** : écrite à la fois par persona-service (`findOneAndUpdate` upsert sur `{key, organisation, personaId}`, sans ts) et par le modèle Mongoose LL.
- **`personaidentifiers`** (ancien format : `uniqueIdentifier{key, value}`, `identifiers[]`, `persona`, `organisation`) : migrée par 20171127. La migration qui la supprime n'est pas enregistrée (voir §4), elle peut donc encore exister.
- **Lues par xapi-service** :
  - `client` : `api.basic_key`, `api.basic_secret`, `isTrusted`, `authority` (**chaîne JSON parsée**), `scopes`, `lrs_id`, `organisation` ;
  - `organisations` : `expiration`. Si `expiration` n'est pas null et est passée, le client est refusé ;
  - `lrs` : existence et `$inc statementCount` ;
  - `oAuthTokens` : `findOne({accessToken})` (voir `repo/authRepo/getClient/mongo.js`).
- **`states`, `agentProfiles`, `activityProfiles`** : aucune référence dans ce dépôt. Elles appartiennent à xapi-service, utilisent le champ **`lrs`** (et non `lrs_id`) et **n'ont aucun index**, ni ici ni dans xapi-service. Détail dans `learninglocker-xapi-service/docs/02-donnees-config.md`.
- **`journeys`, `journeyprogresses`** : seulement présentes dans la liste blanche des `$lookup` (`lib/helpers/filter$lookup.js:13-28`). Ce sont des vestiges d'un plugin entreprise.
- **`statementSamples`, `statementOrgSamples`** : créées par `$sample` + `$out`, puis supprimées (drop) par orgUsageTracker.

### 2.3 Indices d'un contrat partagé avec xapi-service

- **Même base et même `MONGODB_PATH`.** Les noms de collections sont codés en dur des deux côtés (`xapi-statements/.../mongoModels/constants.js` : `statements`, `lrs`, `fullActivities`).
- **Notification des nouveaux statements par Redis** :
  - xapi-statements 7.8 (paquet npm) fait `RPUSH {prefix}:statement.new <uuid1> <uuid2>…` (UUID **bruts**) puis `PUBLISH {prefix}:statement.notify ''` (`repo/eventsRepo/emitNewStatements/redis.js`).
  - Le worker LL s'abonne à `cachePrefix('statement.notify')`, fait `RPOP cachePrefix('statement.new')`, puis `JSON.parse(payload).statementId` et `findOne({'statement.id'})` (`worker/src/handlers/statement/listenForRedisPublish.js:36`).
  - **Format réel.** Le paquet npm 7.8 est ancien et pousse des UUID bruts, ce qui ferait échouer `JSON.parse` côté worker. La version courante de [xapi-service](https://github.com/LearningLocker/xapi-service) (v7.1.x, `src/apps/statements/service/storeStatements/index.ts:66`) pousse `JSON.stringify({statementId, …})` : elle est **compatible** avec le worker. Vérifier tout de même la version déployée avec `redis-cli MONITOR` pendant l'envoi d'un statement.
  - **Priorité de traitement.** Avec `ENABLE_QUEUE_PRIORITY=true`, xapi-service écrit les statements de basse priorité dans `{prefix}_LOW:statement.new` / `{prefix}_LOW:statement.notify`. Le worker de ce dépôt n'écoute pas ces clés : laisser l'option désactivée, ou la prendre en charge dans la version 2026.
  - `RPUSH` + `RPOP` donne un ordre LIFO, pas FIFO.
  - **Il faut le même `REDIS_PREFIX`, non vide, des deux côtés.** Défaut xapi-service : `LEARNINGLOCKER` ; LL n'en met aucun si `REDIS_PREFIX` est vide.
  - Message réel de xapi-service v7.1.x : `{"statementId":"<uuid>","organisationId":"<hex>"}`.
  - **`EVENTS_REPO=sqs` côté xapi-service est incompatible avec ce worker** : xapi envoie l'UUID xAPI dans `{QUEUE_NAMESPACE}_STATEMENT_QUEUE`, alors que `statementHandler` attend le `_id` Mongo. Le message est perdu.
- **Pièces jointes** : `{subFolder}/{lrs_id}/attachments/{sha2}.{ext}`. En local, le chemin est `{FS_LOCAL_ENDPOINT}/{FS_SUBFOLDER}/statements/{lrs_id}/attachments/…`. Le worker LL relit les pièces jointes pour le forwarding (`getStatementsRepo.js`).
- **Encodage `&46;`** : utilisé pour les clés d'extensions de `statements` et de `fullActivities`, et dans la clé de `metadata`.
- **Les champs `authority` et `scopes` du client** font partie du contrat d'authentification.

### 2.4 Langage de requête stocké (contrat de données)

Ces champs sont des **chaînes JSON** contenant des opérateurs maison, convertis par `lib/helpers/parseQuery.js` :
- `visualisations.filters`, `axes*Query` ;
- `dashboards.shareable.filter` ;
- `users.organisationSettings.filter` ;
- `statementForwarding.query` ;
- `queries.conditions` ;
- `batchDelete.filter`.

Opérateurs maison :
- `{$oid: '…'}` donne un ObjectId ;
- `{$dte: 'ISO+offset'}` donne une Date, et l'offset est réécrit quand le fuseau de l'org change ;
- `{$personaIdent: {key, value}}` donne `{$in: [personaIds]}`, résolu via `personaService.getAttributes` ;
- les `$comment` contiennent un `criteriaPath` JSON exploité par le front et par la migration `$in`.

`parseQuery` supprime aussi les étapes `$out` et filtre les `$lookup` (liste blanche, plus le `$match` de scope).

## 3. Connexions (`lib/connections/`)

### Mongoose (`lib/connections/mongoose.js`)

- `mongoose.Promise = bluebird`.
- `mongoose.set('useNewUrlParser', true)`, `set('useFindAndModify', false)`, `set('useCreateIndex', true)` (l.9-11).
- `createConnection(process.env.MONGODB_PATH, {promiseLibrary: Bluebird, socketTimeoutMS, poolSize})` :
  - `poolSize` = `MONGO_CONNECTION_POOLSIZE`, défaut 20 ;
  - `socketTimeoutMS` = `MONGO_SOCKET_TIMEOUT_MS`, défaut 300000.
- Une connexion par namespace (`'ll'`) et par process. Erreurs envoyées vers `console.error`.
- Pas de readPreference, de readConcern ni de writeConcern globaux, donc `primary`.
- Exceptions :
  - les agrégations de statements font `.read('secondaryPreferred')` (`statement.js:115`) ;
  - express-restify-mongoose est configuré en `readPreference:'primary'` (`lib/constants/auth.js:219`).
- Driver brut : accès via `connection.collection(name)` et `Model.collection` (driver 3.3.5 embarqué par Mongoose).
- Le paquet **`mongodb` 2.2.36** est seulement importé pour `ObjectID` et `MongoError` (`lib/services/importPersonas/updateQueryBuilderCache.js:1`, `cli/.../20171127214900_migrate_identifiers.js:7`, fixtures). Il n'y a pas de `MongoClient.connect` dans le code LL.
- Le serveur UI lit aussi Mongo directement : `Dashboard.findById` dans `ui/src/controllers/renderDashboard.js:37`.

### Persona-service (`lib/connections/personaService.js`)

- Second pool via `MongoClient.connect(MONGODB_PATH, options)`, avec le driver **2.2.x** du paquet.
- Les options viennent de `persona-service/dist/config.js` (variables d'environnement) : `MONGO_ACCEPTABLE_LATENCY_MS`, `MONGO_APP_NAME`, `MONGO_BUFFER_MAX_ENTRIES`, `MONGO_CONNECT_TIMEOUT_MS`, `MONGO_MAX_STALENESS_SECONDS`, `MONGO_POOL_SIZE`, `MONGO_READ_CONCERN` (défaut `local`), `MONGO_READ_PREFERENCE` (défaut `primary`), `MONGO_SECONDARY_ACCEPTABLE_LATENCY_MS`, `MONGO_SOCKET_TIMEOUT_MS`.
- Ce sont des noms de variables différents de ceux de LL.

### Redis (`lib/connections/redis.js`, ioredis 4)

- `EVENTS_REPO` vaut `redis` (défaut) ou `sentinel`.
- Mode redis : `REDIS_URL`, sinon `REDIS_HOST` / `REDIS_PORT` (6379) / `REDIS_DB` (0) / `REDIS_PASSWORD`.
- Mode sentinel : `SENTINEL_DB`, `SENTINEL_PASSWORD`, `SENTINEL_NAME` (`mymaster`), `SENTINEL_CONNECTIONS` (`"h:p h:p"`).
- **`createClient()` ouvre une nouvelle connexion à chaque appel, sans singleton ni `quit()`.** C'est le cas par requête d'agrégation (`statement.js:232`, `:420`), ce qui fuit des connexions.
- Bull utilise `createClient: redis.createClient`.

### Autres connexions

- `multer.js` : fichiers temporaires dans `uploads/`.
- `nodemailer.js` : SMTP.
- `supertestApi.js` : tests.

## 4. Migrations

### 4.1 Mécanisme (`cli/src/migrateMongo/index.js`, `migrate.js`)

- Commandes : `node cli/dist/server migrateMongo [--up [key|next]] [--down <key|last>] [--info [v]] [--fixOrder]`. Scripts yarn : `migrate` et `rollback`.
- La liste de référence est l'`OrderedMap` de `cli/src/commands/v2-migrations/index.js`. **L'ordre d'insertion fait foi**, pas la date du nom de fichier.
- **Collection de suivi `migrations`** : un document par migration jouée, `{key, upFn: up.toString(), order, createdAt, updatedAt, __v}`.
- `checkRunMigrations` compare, position par position, les documents triés par `order` avec la liste du code. Tout écart lève une erreur. Le message d'erreur cite la « v1 migrations collection » : une base issue de LL v1 (Laravel) peut contenir une collection `migrations` incompatible.
- La « dernière migration » est déterminée par `sort {order:-1, updatedAt:-1}`.
- En cas d'échec d'un `up`, le `down` correspondant est exécuté puis l'erreur est relancée.
- Le `down` supprime l'entrée avec `Migration.find({key}).remove()` (`migrate.js:9-11`).

### 4.2 Liste des migrations v2, dans l'ordre d'exécution réel

| # | Clé | Effet |
|---|---|---|
| 1 | `20171122100800_common_indexes` | Crée 15 index sur `statements`, l'index unique `apiKey_apiSecret` sur `client`, et l'index unique `org_lrs_id_activityId` sur `fullActivities`. Les promesses **ne sont pas awaitées**. |
| 2 | `20171121153300_update_refs` | Remplit `activities`, `agents`, `registrations`, `relatedActivities`, `relatedAgents`, `verbs` et `rev:1` sur les statements (y compris via `refs`), avec les helpers de xapi-statements. Crée 6 index `{organisation, lrs_id, X}` (non awaités). Le down fait un `$unset`. |
| 3 | `20171008104700_personas_indexes` | `personaService.migrate()` crée les index de `personas`, `personaIdentifiers` et `personaAttributes`. Non awaité. |
| 4 | `20171127214900_migrate_identifiers` | Copie `personaidentifiers` vers `personaIdentifiers` (format `ifi`, `account` ordonné `{homePage, name}`). Crée des `personaAttributes` à partir des identifiants non-statement (préfixe `persona.import.` retiré). En cas de doublon, réaffecte `statements.personaIdentifier` et `person`. **Le down vide `personaIdentifiers` et `personaAttributes`.** |
| 5 | `20180320093000_shareable_dashboards` | Déplace `filter`, `visibility` et `validDomains` de la racine vers `shareable[0]`. Utilise `strict:false` et `safe:false`. |
| 6 | `20180411160000_site_settings` | Insère `siteSettings` avec `_id 111111111111111111111111`. Le down fait un drop. |
| 7 | `20180212_expiration` | Pose `expirationNotifications` à `NOOP` quand le champ manque. **Le down vise la mauvaise collection (`organisation`).** |
| 8 | `20190131000000_oauth_tokens` | Index TTL `{expireAt:1}` avec `expireAfterSeconds:0` sur `oAuthTokens`. Le down fait un drop de la collection. |
| 9 | `20190212150000_personaAttributes_indexes` | Index `personaId_key` `{personaId:1, key:1}`. Non awaité. |
| 10 | `20190307130000_migrate_to_in_queries` | Réécrit `$or`/`$nor` en `$in`/`$nin` dans visualisations, dashboards, statementForwarding, users et queries. Conserve les champs `old*` et pose `hasBeenMigrated`. Bug : un `return` dans la boucle arrête tout dès le premier document déjà migré. |
| 11 | `20190509000000_migrate_null_resetTokens` | `collection('users').update(...)` **sans `multi`** : un seul utilisateur est modifié. Passe les `resetTokens.$.expires` à null à J+1. |
| 12 | `20190711090000_persona_imports` | Déplace `primary` de la colonne `COLUMN_ACCOUNT_KEY` vers la colonne liée. |
| 13 | `20190627000000_fix_typo_last_1_years` | `previewPeriod` : `LAST_1_YEARS` devient `LAST_2_YEARS`. |
| 14 | `20190719000000_migrate_viz_types_of_templates` | `templateId` 1 à 7 devient le `type` `TEMPLATE_*`. Supprime `templateId` et `templateStage`. |
| 15 | `20200227000000_rename_curatr_vis_tpl_types_to_stream` | `TEMPLATE_CURATR_*` devient `TEMPLATE_STREAM_*`. |
| 16 | `20200228000000_rename_curatr_dashboards_to_stream` | Remplace « Curatr » par « Stream » dans les titres de dashboards. Utilise une regex avec `$options:'g'`. |
| — | `20171128144900_remove_old_idents` | **Fichier présent mais non enregistré** dans `index.js`. Il supprimerait `personaidentifiers`. |

### 4.3 Commandes v1 et commandes de données hors framework

Toutes sont déclarées dans `cli/src/server.js`.

**v1** (`cli/src/commands/v1-migrations/`) :
- `migrateV1-LRS [orgId]` : rattache les LRS sans org, puis met à jour l'organisation des statements, l'organisation des clients et les compteurs.
- `migrateTimestamps` : ajoute `createdAt`/`updatedAt` sous forme de **chaîne ISO** sur client, lrs, organisations, users et visualisations.
- `migrateClientAuthority` : convertit `authority` objet en chaîne JSON.
- `migrateClientId` : copie `statements.client_id` (String) vers `client` (OID).
- `migrateXAPIReadScope` : remplace `all/read` par `xapi/read`.

**Autres commandes** :
- `migrateVisualiseQueries`.
- `migrateToOrgSettings`, **cassée** : utilise `.stream()`, retiré en Mongoose 5.
- `migrateExportsToCSV`, `migrateScopesToRoles`, `migrateDownloadPaths`, `migrateVisualiseAxes`.
- `migrateQueryBuilderCachesPath` : bulk insert des sous-chemins.
- `migrateToInQueries` / `migrateFromInQueries`.
- `updateStatementCount`.
- `updateStatementOrganisation`, **cassée** : utilise `model('LRS')` alors que le modèle s'appelle `Lrs`.
- `requeueStatements [lrs_id] --since`.
- `batchJobs` (querybuildercache / personas).
- `clearAggregationCache` (`KEYS` Redis).
- `disableRegister` : upsert de `siteSettings`.
- `createSiteAdmin <email> <org> <password> [-f]`.
- `expirationNotificationEmails`, `orgUsageTracker`, `testStatementForwarding`, `testQueryBuilderCache`, `seed` (`dropDatabase` puis migrations, en environnement test uniquement), `bulkInsert`.
- `verifyJiscRelations` importe `lib/plugins/jisc_1_2_6`, qui n'existe pas, et n'est pas enregistrée.

**`createSiteAdmin`** (`cli/src/commands/createSiteAdmin.js`) :
- insère le document `siteSettings` (`_id` fixe, ignore l'erreur 11000) ;
- trouve ou crée l'utilisateur (`scopes:['site_admin']`, `verified:true`, mot de passe haché par le hook) ;
- trouve ou crée l'organisation par `name`, ce qui déclenche la création des rôles Observer et Admin ;
- ajoute l'org à l'utilisateur et le scope `all` dans `organisationSettings`.

### 4.4 Catalogue des index et origine de chacun

Il n'existe **aucune commande `createIndexes`**. Les index ont trois origines : (a) l'autoIndex Mongoose au démarrage, (b) les migrations ci-dessus, (c) les migrations propres à xapi-service, absentes de ce dépôt et à récupérer.

| Collection | Nom (clés) | Options | Origine |
|---|---|---|---|
| statements | `organisation_1_timestamp_-1__id_1` | | schéma |
| statements | `org_objId_objType` (organisation, statement.object.id, statement.object.objectType) | | migr. 1 |
| statements | `org_lrs_voided_verbId_objType` (organisation, lrs_id, voided, statement.verb.id, statement.object.objectType) | | migr. 1 |
| statements | `org_lrs_voided_verbId_objId` (…, voided, statement.verb.id, statement.object.id) | | migr. 1 |
| statements | `org_lrs_voided_mbox` (…, voided, statement.actor.mbox) | | migr. 1 |
| statements | `org_lrs_voided_account` (…, voided, statement.actor.account.name, statement.actor.account.homePage) | | migr. 1 |
| statements | `org_lrs_voided_timestamp__id` (…, voided, timestamp:-1, _id:-1) | | migr. 1 |
| statements | `org_lrs_voided_stored__id` (…, voided, stored:-1, _id:-1) | | migr. 1 |
| statements | `statementId_lrs_id` (statement.id, lrs_id) | | migr. 1 |
| statements | `org_stored__id` (organisation, stored:-1, _id:1) | | migr. 1 |
| statements | `org_objId` (organisation, statement.object.id) | | migr. 1 |
| statements | `org_verbId_objId` (organisation, statement.verb.id, statement.object.id) | | migr. 1 |
| statements | `org_ident` (organisation, personaIdentifier) | | migr. 1 |
| statements | `org_person_timestamp` (organisation, person._id, timestamp:-1) | | migr. 1 |
| statements | `org_voided` (organisation, voided) | | migr. 1 |
| statements | `org_lrs_hash` (organisation, lrs_id, hash) | **unique** | migr. 1 |
| statements | `organisation_1_lrs_id_1_{activities, agents, registrations, relatedActivities, relatedAgents, verbs}_1` (6 index) | | migr. 2 |
| statementSamples, statementOrgSamples | `organisation_1_timestamp_-1__id_1` | | schéma |
| client | `organisation_1`, `lrs_id_1` | | schéma |
| client | `apiKey_apiSecret` (api.basic_key, api.basic_secret) | **unique** | migr. 1 |
| fullActivities | `org_lrs_id_activityId` (organisation, lrs_id, activityId) | **unique** | migr. 1 |
| personas | `organisation_1` | | persona-service (migr. 3) |
| personaIdentifiers | `organisation_1_persona_1` | | persona-service |
| personaIdentifiers | `organisation_1_ifi_1` | **unique** | persona-service |
| personaAttributes | `organisation_1_personaId_1_key_1` | | persona-service |
| personaAttributes | `personaId_key` | | migr. 9 |
| personaAttributes | `organisation_1`, `personaId_1` | | schéma |
| oAuthTokens | `expireAt_1` | **TTL**, `expireAfterSeconds:0` | migr. 8 |
| users | `email_1` | **unique** | schéma |
| users | `organisations_1`, `organisationSettings.organisation_1`, `ownerOrganisation_1` | | schéma |
| queryBuilderCaches | `organisation_1`, `path_1` (multikey) | | schéma |
| queryBuilderCaches | `organisation_1_searchString_1` | **unique** | schéma |
| queryBuilderCaches | `organisation_1_path_1_createdAt_-1__id_1` | | schéma |
| queryBuilderCacheValues | `organisation_1_path_1_hash_1` | **unique** | schéma |
| queryBuilderCacheValues | `organisation_1_path_1_updatedAt_-1__id_1` | | schéma |
| importPersonasLock | `ifis_1` | **unique, multikey sur Mixed** | schéma |
| importPersonasLock | `organisation_1` | | schéma |
| personasImports | `owner_1`, `organisation_1`, `organisation_1_updatedAt_-1__id_1` | | schéma |
| statementForwarding | `organisation_1`, `lrs_id_1`, `owner_1`, `organisation_1_timestamp_-1__id_1` | | schéma |
| dashboards, visualisations, queries, exports, downloads, importcsv | `organisation_1`, `owner_1` | | schéma |
| lrs, role, streams, personasImportTemplates | `organisation_1` | | schéma |
| batchDelete | `client_1`, `organisation_1` | | schéma |
| importdata | `importModel_1` | | schéma |
| accessToken | `token_1` | | schéma, jamais construit (modèle jamais chargé) |

Remarques :
- Tous les index créés par les migrations portent `background:true`, option ignorée depuis MongoDB 4.2.
- Il n'existe aucun index sparse.
- Le seul index TTL est sur `oAuthTokens`.

## 5. Redis

### Clés applicatives

`P` désigne le préfixe `REDIS_PREFIX:` (`lib/helpers/cachePrefix.js`). Si `REDIS_PREFIX` est vide, il n'y a pas de préfixe du tout.

| Clé | Commande / TTL | Source |
|---|---|---|
| `P{orgId}-AGGREGATION-{sha1(pipeline)}-{skip}-{limit}-DATA` | SETEX `AGGREGATION_CACHE_SECONDS` (300) | `statement.js:233-249` |
| `…-RUNNING` | SETEX 300 | idem |
| `P{orgId}-AGGREGATION-ASYNC-{sha1}-{skip}-{limit}-STARTED-AT` / `-COMPLETED-AT` / `-RESULTS` | SETEX `ASYNC_AGGREGATION_CACHE_SECONDS` (604800) | `statement.js:286-342` |
| `…-QUERY-RUNNING` | SETEX 10 s, rafraîchie toutes les 5 s | idem |
| `PEXPIRATION_SCHEDULER:RUNNING` | SET NX EX 30 | `cli/src/scheduler.js` |
| `PORG_USAGE_SCHEDULER:RUNNING` | SET NX EX 3600 | idem |
| `PBATCH_STATEMENT_DELETION_SCHEDULER:RUNNING` | SET NX EX 30 | `cli/src/scheduler/batchDelete.js` |
| `Pstatement.new` (liste) et `Pstatement.notify` (canal pub/sub) | RPUSH et PUBLISH par xapi-service ; SUBSCRIBE et RPOP par LL | §2.3 |

`clearAggregationCache` utilise `KEYS P*-AGGREGATION-*`.

### Files de messages

- Provider choisi par `QUEUE_PROVIDER` : `REDIS`/`BULL`, `SQS`, `PUBSUB`, `SERVICE_BUS` ou `LOCAL`. Le nom réel d'une file est `${QUEUE_NAMESPACE}_${nom}`.
- Avec Bull 3, les clés ont la forme `bull:{QUEUE_NAMESPACE}_{nom}:{id|wait|active|delayed|failed|completed|…}`. **`REDIS_PREFIX` n'y est pas appliqué.**
- Noms de files :
  - `STATEMENT_QUEUE`
  - `STATEMENT_PERSON_QUEUE`
  - `STATEMENT_QUERYBUILDERCACHE_QUEUE`
  - `STATEMENT_FORWARDING_QUEUE`
  - `STATEMENT_FORWARDING_REQEUST_QUEUE` (faute de frappe d'origine, à conserver)
  - `STATEMENT_FORWARDING_REQUEST_DELAYED_QUEUE`
  - `STATEMENT_FORWARDING_DEADLETTER_QUEUE`
  - `ORG_USAGE_TRACKER_QUEUE`
  - `BATCH_STATEMENT_DELETION_QUEUE`
  - `EMAIL_EXPIRATION_NOTIFICATION_QUEUE`
  - `PERSONA_IMPORT_QUEUE`
- Les payloads de forwarding contiennent le statement complet **et le document statementForwarding, secrets compris**.

## 6. Stockage de fichiers (`lib/services/files/storage/`)

Le backend est choisi par `FS_REPO` : `local` (défaut), `amazon` (pkgcloud S3), `google`, `azure`, ou `rackspace` (non documenté).

Racine :
- local : `{FS_LOCAL_ENDPOINT || cwd}/{FS_SUBFOLDER || 'storage'}/<clé>` ;
- S3 : bucket `FS_AWS_S3_BUCKET`, clé `{FS_SUBFOLDER || 'storage'}/<clé>` ;
- GCS : bucket `FS_GOOGLE_CLOUD_BUCKET`, même préfixe ;
- Azure : conteneur `FS_AZURE_CONTAINER_NAME`, blob `{FS_SUBFOLDER || 'storage'}/<clé>`.

Clés utilisées :
- **Logos** : `logos/{orgId}`. Le document `organisation.logo` vaut `{key, mime, repo}` et `logoPath` vaut `/api/downloadlogo/{orgId}` (`uploadLogo.js:36`, `downloadLogo.js:66`).
- **Exports CSV** : `downloads/{Date.now()}-{orgId}-{uuid}.csv`, enregistré dans `download.upload.key` (`exportStatements.js:43`).
- **Imports de personas** : `personasCsvs/{personasImportId}.csv` et `personasCsvs/{id}-error.csv` (`importPersonas/persistPersonas.js`).
- **Pièces jointes xAPI** : voir §2.3.
- Fichiers temporaires de multer : `uploads/`.

Le champ `upload.repo` mémorise `FS_REPO` au moment de l'écriture, mais il n'est pas relu : la lecture utilise toujours le `FS_REPO` courant.

Deux anomalies :
- `getStatementsRepo.js:9` contient `defaultTo('statements', SUB_FOLDER_STATEMENTS)`, inversé, qui vaut donc toujours `'statements'`.
- `uploadPeople.js` importe `addCSVToQueue`, qui n'existe pas (code mort).

## 7. Agrégations MongoDB et fonctionnalités dépréciées

### Agrégations

- **Agrégation des statements** (`lib/models/statement.js:112-128`) :
  - `Statement.aggregate(pipeline).read('secondaryPreferred').allowDiskUse(ALLOW_AGGREGATION_DISK_USE, défaut true)` ;
  - `skip` et `limit` en option, `query.options.maxTimeMS = …` (mutation interne), puis `.cursor({batchSize}).exec()` ;
  - un `$match` de scope est préfixé, et `$sample` aussi si `sampleSize` est fourni ;
  - le résultat est sérialisé en chaîne JSON, puis éventuellement mis en cache Redis.
- **Pipelines construits par le front** (`ui/src/utils/visualisations/**`) et envoyés via `/api/statements/aggregate`. Ils utilisent `$match`, `$project`, `$group`, `$unwind`, `$sort`, `$limit`, `$count`, `$dateToString` et `$dayOfWeek` avec `timezone`, ainsi que `$lookup` avec `let`/`pipeline`/`$expr` sur `personaAttributes` (`aggregationGroup/grouper/index.js:83-117`).
- `filter$lookup` ajoute un `pipeline` à **tout** `$lookup`. Combiné avec `localField`/`foreignField`, cela demande MongoDB 5.0+.
- **orgUsageTracker** (`worker/src/handlers/orgUsageTracker/orgUsageTracker.js`) : `$sample {size:10000}` puis `$out 'statementSamples'` avec `allowDiskUse(true)` ; ensuite `$match`, `$out 'statementOrgSamples'` et `collection.stats()`.
- **Exports** : `aggregateByAuth` en flux, `limit 500000`, `maxTimeMS 0`.
- Valeurs par défaut : `MAX_TIME_MS` = 0, donc illimité.

### Occurrences dépréciées ou retirées

| Élément | Fichier:ligne | Statut |
|---|---|---|
| `useNewUrlParser`, `useFindAndModify`, `useCreateIndex` | `lib/connections/mongoose.js:9-11` | Options supprimées en Mongoose 6 : `mongoose.set` lève une erreur |
| `poolSize`, `promiseLibrary`, `mongoose.Promise` | `lib/connections/mongoose.js:8,14,26` | Driver 4+ : `maxPoolSize`. Plus de promesses custom en Mongoose 7. |
| `aggregate().cursor({batchSize}).exec()` et `query.options.maxTimeMS` | `lib/models/statement.js:122-126` | Mongoose 6 : `cursor()` renvoie directement le curseur, sans `exec` |
| `Model.update` | `lib/models/lrs.js:93` | Supprimé en Mongoose 7 |
| `collection('users').update` (driver) | `v2-migrations/20190509000000_migrate_null_resetTokens.js:9` | Supprimé du driver Node récent |
| `Model.count()`, `Query.count()` | `worker/src/handlers/orgUsageTracker/initializeOrgStatsList.js:13,21`, `orgUsageTracker.js:24,40` | Déprécié, retiré en Mongoose 8 |
| `collection.stats()` (collStats) | `orgUsageTracker.js:34` | collStats déprécié depuis MongoDB 6.2 (à remplacer par `$collStats`) ; la méthode n'existe plus dans le driver récent |
| `doc.remove()`, `Query.remove()` | `lib/services/importPersonas/importPersona.js:145,159`, `cli/src/migrateMongo/migrate.js:11`, et le DELETE d'express-restify-mongoose (`findOneAndRemove:false`, `lib/constants/auth.js:218`) | Supprimés en Mongoose 7 |
| Hooks `pre/post('remove')` | `lib/models/role.js:59`, `organisation.js:353`, `statement.js:97` | Ne se déclenchent plus en Mongoose 7 : passer à `deleteOne` |
| `Query.stream()` | `cli/src/commands/migrateToOrgSettings.js:80` | Déjà retiré (Mongoose 5) |
| Callbacks Mongoose | `lib/models/lrs.js:40,80`, `user.js:310,447`, `organisation.js:247`, `api/src/auth/passport.js:140,181,231`, `AuthController.js:47,58,110`, `worker/.../wrapHandlerForStatement.js:8`, `statementHandler.js` (`updateOne`/`findById` avec callback), plusieurs commandes CLI | Supprimés en Mongoose 7 (liste non exhaustive) |
| `mongoose.Types.ObjectId(x)` sans `new` | Environ 40 appels dans 29 fichiers : `lib/helpers/convert$oid.js`, `lib/models/plugins/filterByOrg.js`, `lib/services/auth/modelFilters/*`, `lib/services/persona/*`, worker, CLI… | Lève une TypeError en Mongoose 7+ (bson 5) |
| `{safe:false}` | `v2-migrations/20180320093000_shareable_dashboards.js:37,66` | Option obsolète |
| `{multi:true}` passé à `updateMany` | `cli/src/commands/updateClientOrganisation.js:12` | Option sans effet |
| `$regex` avec `$options:'g'` | `cli/src/commands/migrateCuratrDashboardsToStream.js:8,26` | Flag invalide. De mémoire, MongoDB récent le rejette (« invalid flag in regex options ») ; je ne l'ai pas testé. |
| Bulk `execute({w:0})` | `worker/src/handlers/statement/queryBuilderCacheHandler.js:14-15`, `lib/services/querybuildercache/generateQueryBuilderCaches/index.js:18-19`, `addIdentsToCache/index.js:12-13`, `lib/services/importPersonas/updateQueryBuilderCache.js:73` | Write concern au format hérité. Les doublons sont volontairement ignorés : il faut garder `ordered:false` et `w:0`, ou gérer l'erreur 11000. |
| Internes du driver `batch.s.currentBatch.operations` | `lib/services/importPersonas/updateQueryBuilderCache.js:58-68` | Casse selon la version du driver |
| `err.getOperation()` / `writeErrors` | `v2-migrations/20171127214900_migrate_identifiers.js:78-80` | API d'erreur bulk modifiée |
| `LRS.collection.find(filter, {}, {maxTimeMS})` | `lib/models/plugins/addCRUDFunctions.js:75` | Signature à 3 arguments du driver 2/3 : `maxTimeMS` perdu en driver 4+ |
| Option d'index `background:true` | migrations 1, 2, 3, 9 | Ignorée depuis MongoDB 4.2 |

Aucune occurrence dans le code applicatif de : `$where`, `mapReduce`, `group`, `ensureIndex`, `findAndModify`, geoHaystack, `eval`, `$pushAll`, `$isolated`. Les pipelines et filtres stockés sont cependant fournis par les utilisateurs et peuvent contenir n'importe quel opérateur.

## 8. Risques pour la migration vers MongoDB récent / Mongoose récent

### Pilotes et dépendances

1. **persona-service 1.7.1 utilise le driver mongodb 2.2.36.** Ce driver est incompatible avec MongoDB ≥ 6.0 (opcodes legacy retirés). Il faut le remplacer ou réimplémenter les accès aux collections `personas`, `personaIdentifiers` et `personaAttributes` à l'identique (formes en §2.2, index en §4.4).
2. **xapi-statements 7.8 (driver 3.4) et xapi-service** doivent être mis à niveau de façon coordonnée. Ils écrivent `statements`, `fullActivities` et `lrs.statementCount`, et lisent `client`, `organisations` et `oAuthTokens`. Le driver 3.3.5 embarqué par Mongoose 5.8 n'est pas non plus supporté sur MongoDB 7/8.
3. **Chemin de montée de version du serveur depuis 4.2** : il faut passer par 4.4, 5.0, 6.0, 7.0 puis 8.0, en réglant `setFeatureCompatibilityVersion` à chaque étape. L'alternative est un mongodump/mongorestore ; dans ce cas, vérifier la recréation des index, en particulier le TTL et les uniques.

### Ruptures Mongoose 5 → 8

4. Les points à traiter :
   - callbacks ;
   - `remove()` et les hooks `remove` (logique métier des rôles, de l'organisation et du compteur LRS) ;
   - `update()`, `count()` ;
   - `ObjectId` sans `new` ;
   - les options de connexion et `mongoose.Promise` ;
   - `aggregate().cursor().exec()` ;
   - `strictQuery` (true par défaut en Mongoose 6, ce qui supprimerait les filtres sur des champs hors schéma comme `agents` ou `activities`, puis false à nouveau en Mongoose 7+).
5. **express-restify-mongoose 3.2 est incompatible.** Si l'API REST `/api/v2/<model>` doit rester compatible avec le front, elle doit être réécrite en conservant le contrat (`query`, `sort`, `select`, etc.).
6. **mongoose-timestamp** doit être remplacé, de préférence par l'option native `timestamps` qui garde les mêmes noms de champs. La sémantique change : le natif met aussi `updatedAt` à jour sur `updateOne`/`updateMany`, ce qui n'était pas le cas jusqu'ici. Le natif ne pose pas non plus `createdAt` si un document existant ne l'a pas.

### Index

7. **L'autoIndex au démarrage construit `organisation_1_timestamp_-1__id_1` sur `statements`**, ainsi que les collections `statementSamples` et `statementOrgSamples`. La nouvelle application devra gérer ses index par migration explicite.
8. **Il faut réutiliser exactement les mêmes noms et options d'index.** Créer un index de mêmes clés sous un autre nom ou avec d'autres options lève un conflit (`IndexOptionsConflict`). Les migrations historiques n'awaitaient pas leurs `createIndex` : sur une base existante, il faut vérifier que tous les index du §4.4 existent vraiment.
9. **Il faut aussi rapatrier le catalogue d'index de xapi-service**, absent de ce dépôt.

### Contrats de données à préserver à l'identique

10. **Noms de collections**, y compris les singuliers et les casses mixtes : `client`, `role`, `lrs`, `batchDelete`, `statementForwarding`, `importcsv`, `importdata`, `accessToken`, `refreshToken`, `queryBuilderCaches`, `oAuthTokens`, `personaIdentifiers` (et l'ancienne `personaidentifiers`), `audits` (pluralisé).
11. **Fautes de frappe d'origine** : `LOCKOUT_ATTEMPS`, `STATEMENT_FORWARDING_REQEUST_QUEUE`.
12. **Champs stockés en chaîne JSON** : `client.authority` (lue par xapi-service), `visualisations.filters`/`axes*`, `queries.conditions`, `dashboards.shareable.filter`, `users.organisationSettings.filter`, `statementForwarding.query`/`headers`, `exports.projections`, `batchDelete.filter`.
13. **Opérateurs maison et encodages** : `$oid`, `$dte`, `$personaIdent`, `$comment`/`criteriaPath`, et l'encodage `&46;`.
14. **Algorithmes à reproduire** :
    - bcryptjs `$2a$`, coût 8, pour `password` et `passwordHistory` ;
    - `resetTokens` = `bcrypt(email)` stocké en clair et comparé par égalité ;
    - `hash` de `queryBuilderCacheValues` (sha1 au-delà de 40 caractères, sinon la chaîne JSON) ;
    - `statements.hash` (object-hash sha1, côté xapi) ;
    - clé et secret client en 40 caractères hexadécimaux.
15. **`siteSettings._id` fixe** à `111111111111111111111111`.
16. **Ordre des clés** `ifi.value {homePage, name}`, imposé par l'index unique.
17. **`_id` des sous-documents** `dashboards.shareable[]`, présents dans les URL et JWT.
18. **`statement.timestamp`/`stored` en chaîne** contre `timestamp`/`stored` en Date à la racine.
19. **`REDIS_PREFIX` identique** entre LL et xapi-service, et format des clés de cache.
20. **`APP_SECRET` inchangé**, pour la validité des JWT en circulation.

### Sécurité, à arbitrer lors de la réécriture

21. Plusieurs secrets sont stockés **en clair** :
    - `client.api.basic_secret`, qui ne peut pas être haché sans modifier xapi-service ;
    - les secrets token et basic de `statementForwarding` ;
    - `dashboards.shareable.filterJwtSecret` ;
    - la copie de `api` (clé et secret) dans `audits.metadata` à la suppression d'un client.

    Les payloads des files Redis contiennent également les secrets de forwarding.
22. Les pipelines fournis par l'utilisateur ne sont filtrés que pour `$out` et `$lookup`. **`$graphLookup`, `$unionWith` (4.4+), `$merge` (4.2+), `$function` et `$accumulator` passent**, ce qui permet de lire d'autres collections, dont `users`, ou d'y écrire. Il faut passer à une liste blanche d'étapes.

### Bugs et code mort à ne pas reproduire, ou à décider

23. Les éléments concernés :
    - la migration `remove_old_idents`, non enregistrée ;
    - le down de 20180212, qui vise la mauvaise collection ;
    - la migration 20190509, qui ne modifie qu'un seul document ;
    - le `return` dans les boucles de `migrateToInQueries` ;
    - les commandes cassées `updateStatementOrganisation` (`model('LRS')`) et `migrateToOrgSettings` (`.stream()`) ;
    - `verifyJiscRelations` et `uploadPeople`, qui importent des modules absents ;
    - les modèles `AccessToken`, `RefreshToken` et `ImportData`, et le plugin `softDelete`, jamais utilisés ;
    - l'index de `statementForwarding` sur un champ `timestamp` inexistant ;
    - le défaut figé de `shareable.createdAt` ;
    - le validateur `PASSWORD_HISTORY_TOTAL` ;
    - les défauts `PASSWORD_REQUIRE_NUMBER` incohérents entre User et Organisation ;
    - la fuite d'une connexion Redis par agrégation ;
    - `listenForRedisPublish`, qui retrouve le statement par `statement.id` sans filtre org/lrs ;
    - `Promise.all([map(...)])` non awaité (`updateQueryBuilderCache.js:73`) ;
    - `batchStatementDeletion` (`deleteMany`), qui ne décrémente pas `lrs.statementCount`.
24. **Données héritées pouvant subsister** :
    - les champs v1 `statements.lrs`, `client_id`, `refs` ;
    - `createdAt`/`updatedAt` stockés en **chaîne ISO** par `migrateTimestamps` sur client, lrs, organisations, users et visualisations, alors que le type attendu est Date ;
    - les champs `old*` et `hasBeenMigrated` ;
    - les anciens champs de dashboard à la racine ;
    - `personasImports.importedAt` à la date maximale ;
    - la collection `migrations` v1.

    Le nouveau schéma doit tolérer ces formes, ou une migration doit les normaliser.
