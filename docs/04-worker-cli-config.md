# 04. Worker, files de messages, CLI, configuration et build

> [Index de la documentation](README.md) · État du code : commit `5fec948a` (novembre 2021).

**Limite :** `node_modules/` n'est pas installé. Le code interne des paquets `@learninglocker/*` n'a donc pas pu être lu. Les points qui en dépendent sont marqués « à vérifier ».

---

## 0. Synthèse

**Flux principal.** L'**xapi-service** (projet séparé, servi via nginx sur `/data/xAPI` → `XAPI_PORT`) écrit les statements directement dans la collection MongoDB `statements`. Il **ne publie dans aucune queue du worker**. Il signale chaque nouveau statement par Redis :
- un `RPUSH` sur la liste `{REDIS_PREFIX}:statement.new` (cf. [02-donnees.md §2.3](02-donnees.md) pour le format exact, à vérifier) ;
- un `PUBLISH` sur le canal `{REDIS_PREFIX}:statement.notify`.

Le worker s'abonne à ce canal, dépile la liste, puis répartit le statement dans les queues applicatives.

**Conséquence : Redis est obligatoire quel que soit `QUEUE_PROVIDER`**, même avec SQS, Pub/Sub ou Service Bus.

**Abstraction des queues.** `lib/services/queue` propose cinq fournisseurs : bull/Redis, SQS, Pub/Sub, Service Bus et local. Le nom physique d'une queue est `${QUEUE_NAMESPACE}_${NOM}`.

**Processus en production** (`pm2/all.json`) : API, UIServer, Worker et Scheduler. Le Scheduler (`cli/dist/scheduler`) publie des tâches périodiques que le Worker exécute.

**Build.** Le backend est compilé par webpack 3 et babel 6 en un seul `dist/<cible>/index.js` par application. Les `node_modules` sont externes et restent nécessaires à l'exécution. Une bannière injectée en tête de bundle charge `.env` depuis le **cwd**.

**Bloquants majeurs pour Node LTS récent et MongoDB récent :**
- `node-sass` ;
- webpack 3 avec OpenSSL 3 ;
- babel 6 ;
- `@learninglocker/persona-service` 1.7.1, qui embarque le driver `mongodb@2.2.36`, incompatible avec MongoDB ≥ 5.1/6 (opcodes legacy supprimés) ;
- Mongoose 5.8 avec le driver 3.3.5 (officiellement MongoDB ≤ 4.2) ;
- aws-sdk v2 (fin de support), `@google-cloud/pubsub` 0.16, `azure-sb`, `pkgcloud`, winston 2, nodemailer 2, bull 3, sqs-consumer 3.

---

## 1. Worker (`worker/`)

### 1.1 Démarrage

**Entrée : `worker/src/server.js`.** Il appelle dans l'ordre :
1. `statementWorker({})`
2. `expirationNotification()`
3. `importPersonasWorker({})`
4. `orgUsageTracker()`
5. `batchStatementDeletion()`

Il journalise ensuite `STARTED WORKER` puis envoie `process.send('ready')`, attendu par pm2 (`wait_ready`).

**Build :** `worker/build.js` produit `worker/dist/server/index.js`. On le lance avec `node worker/dist/server` (script `start-worker-server`), depuis la racine du dépôt.

**Pas d'arrêt propre :** aucun gestionnaire SIGTERM, les queues ne sont pas fermées. `unsubscribeAll` sert uniquement aux tests.

**`statementWorker`** (`worker/src/handlers/statement/index.js`) :
- appelle `listenForRedisPublish()` (l.42) ;
- s'abonne **toujours** à `STATEMENT_QUEUE`, `STATEMENT_FORWARDING_REQEUST_QUEUE`, `STATEMENT_FORWARDING_REQUEST_DELAYED_QUEUE` et `STATEMENT_FORWARDING_DEADLETTER_QUEUE` ;
- s'abonne à `STATEMENT_PERSON_QUEUE`, `STATEMENT_QUERYBUILDERCACHE_QUEUE` et `STATEMENT_FORWARDING_QUEUE` **seulement** s'ils sont autorisés par `ALLOWED_WORKER_QUEUES`.

**`ALLOWED_WORKER_QUEUES`** (`worker/src/handlers/statement/allowedWorkerQueues.js:13-48`) :
- variable absente : les 3 queues sont actives ;
- chaîne vide : aucune ;
- sinon : liste séparée par des virgules, les noms inconnus sont ignorés avec un warning.

> **Point d'attention.** Le même filtre s'applique à la **répartition** dans `statementHandler.js:54`. C'est le worker qui dépile la notification Redis qui décide des queues de destination. Si des workers tournent avec des valeurs différentes, un statement peut ne jamais atteindre une queue qu'aucun d'eux n'aura alimentée. Il faut alors le rattraper avec `requeueStatements`.

### 1.2 Entrée des statements depuis l'xapi-service

**Fichier : `worker/src/handlers/statement/listenForRedisPublish.js`.**
- Deux clients ioredis (`lib/connections/redis`) : l'un s'abonne à `cachePrefix('statement.notify')`, l'autre fait un `RPOP` sur `cachePrefix('statement.new')`. Le paquet xapi-statements 7.8 fait un `RPUSH` : l'ordre de traitement est donc LIFO.
- Le préfixe vient de `lib/helpers/cachePrefix.js` : `${REDIS_PREFIX}:clé`, ou `clé` seule si `REDIS_PREFIX` est vide.
- À chaque message, la boucle `async.doUntil` dépile jusqu'à vider la liste.
- Chaque payload est lu avec `JSON.parse(payload).statementId`, l'id xAPI (UUID). Le worker cherche ensuite `Statement.findOne({'statement.id': …})` et appelle `statementHandler({ statementId: statement._id })` **directement**, sans passer par `STATEMENT_QUEUE`.

**Format attendu par le consommateur** : élément de liste `{"statementId":"<uuid xAPI>"}`. C'est ce que pousse la version courante d'xapi-service (v7.1.x). L'ancien paquet npm `@learninglocker/xapi-statements@7.8.0` poussait des UUID bruts : vérifier la version déployée (`redis-cli MONITOR`). Ne pas activer `ENABLE_QUEUE_PRIORITY` côté xapi-service : ce worker n'écoute pas les clés `{prefix}_LOW:*`.

**Conditions de compatibilité :** l'xapi-service doit utiliser **le même Redis** (base, sentinel) et **le même `REDIS_PREFIX`** que le worker.

**Bug :** si le statement n'est pas trouvé, `statement._id` lève une `TypeError` (l.36-39), et l'erreur Mongo n'est pas gérée.

### 1.3 Orchestration par statement

**Fichiers :** `statementHandler.js` et `wrapHandlerForStatement.js`.

**État persistant** dans chaque document `statements` (`lib/models/statement.js:52-75`) :
- `processingQueues[]` et `completedQueues[]` : noms logiques des queues ;
- `pendingForwardingQueue[]`, `completedForwardingQueue[]`, `deadForwardingQueue[]` : ObjectId de `statementForwarding` ;
- `failedForwardingLog[]` : `{statementForwarding_id, timestamp, message, errorInfo}`.

**Répartition** (`addStatementToPendingQueues`, l.34-87) :
- Pour chaque queue de `queueDependencies` (les 3 sans prérequis), le statement est envoyé si la queue n'est ni dans `completedQueues`, ni dans `processingQueues`, et qu'elle est autorisée.
- Le worker fait `$addToSet processingQueues`, puis `Queue.publish({queueName, payload:{statementId: _id}})`.

**Fin de traitement :**
- `wrapHandlerForStatement` charge le statement. S'il est absent, le job est purgé.
- Il exécute ensuite le handler métier, puis republie `{status: <nomQueue>, statementId}` dans `STATEMENT_QUEUE`.
- `statementHandler` (l.89-131), en présence d'un `status`, fait `$addToSet completedQueues` et `$pull processingQueues`, puis réévalue les queues restantes.

### 1.4 Handlers et rôle de chacun

| Handler (fichier) | Queue logique | Ce qu'il fait |
|---|---|---|
| `statement/statementHandler.js` | `STATEMENT_QUEUE` | Orchestration (§1.3). |
| `statement/extractPersonasHandler.js` | `STATEMENT_PERSON_QUEUE` | Voir « Personas » ci-dessous. |
| `statement/queryBuilderCacheHandler.js` | `STATEMENT_QUERYBUILDERCACHE_QUEUE` | `getCachesFromStatement` (liste blanche de chemins : actor, verb, object, context, extensions, metadata…, `lib/services/querybuildercache/getCachesFromStatement/index.js:46-71`). Insertions en bulk non ordonné avec `w:0` dans `queryBuilderCaches` (index unique `{organisation, searchString}`) et upsert/replace dans `queryBuilderCacheValues` (unique `{organisation, path, hash}` ; `hash` = sha1 si la valeur sérialisée dépasse 40 caractères). Les doublons sont volontairement ignorés. |
| `statement/statementForwarding/statementForwardingHandler.js` | `STATEMENT_FORWARDING_QUEUE` | Voir « Statement forwarding » ci-dessous. |
| `statement/statementForwarding/statementForwardingRequestHandler.js` | `…REQEUST_QUEUE` et `…REQUEST_DELAYED_QUEUE` | Envoi HTTP. |
| `statement/statementForwarding/statementForwardingDeadLetterHandler.js` | `STATEMENT_FORWARDING_DEADLETTER_QUEUE` | `$addToSet deadForwardingQueue` et `$pull pendingForwardingQueue`. |
| `batchStatementDeletion/batchStatementDeletion.js` | `BATCH_STATEMENT_DELETION_QUEUE` | Voir « Batch deletion » ci-dessous. |
| `expirationNotification/expirationNotification.js` | `EMAIL_EXPIRATION_NOTIFICATION_QUEUE` | Payload `{organisationId, emailType}`. Envoie à **tous les utilisateurs** de l'organisation `sendOrganisationAboutToExpire` (`WEEK_BEFORE_NOTIFICATION`) ou `sendOrganisationExpired` (`EXPIRATION_NOTIFICATION`) via `lib/helpers/email.js`. Passe ensuite `organisation.expirationNotifications.{weekBefore,expiration}NotificationSent` à `EMAIL_SENT`. |
| `importPersonas/importPersonaHandler.js` | `PERSONA_IMPORT_QUEUE` | Voir « Import personas » ci-dessous. |
| `orgUsageTracker/orgUsageTracker.js` (+ `initializeOrgStatsList.js`, `totalUsage.js`) | `ORG_USAGE_TRACKER_QUEUE` | Voir « Org usage tracker » ci-dessous. |
| `statement/batcher.js` | (aucune) | Utilisé par la CLI `batchJobs`. Traite en lot (curseur Mongo, `batchSize` 1000) les statements dont `completedQueues` ne contient pas le type de job, puis `$addToSet completedQueues`. |

#### Personas (`extractPersonasHandler.js`)

1. Calcule l'IFI de l'acteur (`lib/services/persona/utils/getIfiFromActor`).
2. Appelle `personaService.createUpdateIdentifierPersona({organisation, ifi, personaName})`. Le nom vient de `actor.name`, sinon de `getIfiDisplayName`.
3. Puis `getPersona` pour obtenir le nom affiché.
4. Selon le résultat :
   - identifiant existant : renseigne `statement.personaIdentifier` et `statement.person = {_id, display}`, puis `save()` ;
   - identifiant créé : `asignIdentifierToStatements` fait un `updateMany` sur tous les statements de l'organisation qui correspondent à l'IFI (`lib/services/persona/asignIdentifierToStatements.js`).

**Service :** `lib/connections/personaService.js` instancie `@learninglocker/persona-service/dist/service` avec le repo `mongoModelsRepo`. Il ouvre son propre client Mongo (driver `mongodb@^2.2.26`) sur `MONGODB_PATH`, avec les options `persona-service/dist/config`. Les collections persona (`personas`, `personaIdentifiers`, `personaAttributes`) sont dans la même base.

**Méthodes du service utilisées :** `createUpdateIdentifierPersona`, `getPersona`, `getIdentifier`, `updatePersona`, `mergePersona`, `overwritePersonaAttribute`, `migrate` (index).

#### Statement forwarding

**Configuration : collection `statementForwarding`** (`lib/models/statementForwarding.js`). Champs :
- `configuration.protocol` : `http` ou `https` ;
- `configuration.url` : sans schéma ;
- `configuration.authType` : `no auth`, `token` ou `basic auth` ;
- `secret`, `basicUsername`, `basicPassword` ;
- `maxRetries` : entier de 0 à 10 (`STATAMENT_FORWARDING_MAX_RETRIES=10`, `lib/constants/statementForwarding.js`) ;
- `headers` : JSON sous forme de chaîne. Interdits : `Content-Type`, `Content-Length`, `Host`, etc., et `Authorization` si une auth est configurée ;
- `query` : filtre JSON ;
- `fullDocument` ;
- `sendAttachments` ;
- `active`.

**Étape 1 : sélection** (`statementForwardingHandler.js`).
- Cherche les `StatementForwarding` actifs de l'organisation dont l'id n'est pas dans `completedForwardingQueue`.
- Convertit `query` avec `parseQuery` (authInfo de type `worker`) et filtre en mémoire avec `mongoFilteringInMemory` (sift).
- Pour chaque configuration retenue, publie dans `STATEMENT_FORWARDING_REQEUST_QUEUE` le payload `{status, statement: <document Mongo complet>, statementForwarding: <document complet>}`. **Ces messages sont volumineux.**

**Étape 2 : requête sortante** (`statementForwardingRequestHandler.js`).
- `$addToSet pendingForwardingQueue`.
- `POST` axios vers `${protocol}://${url}` avec un timeout de 5000 ms. Un statut est valide s'il est compris entre 200 et 399.
- Corps envoyé :
  - `fullDocument=false` : seulement `statement.statement` ;
  - `fullDocument=true` : le document LL complet ;
  - dans les deux cas, après `mapDot`, qui décode les clés encodées.
- En-têtes :
  - `Content-Type: application/json` ;
  - ou, avec `sendAttachments`, `multipart/mixed; boundary=…`. Le flux est construit par `@learninglocker/xapi-statements` (`getAttachments` et `streamStatementsWithAttachments`) avec le repo de stockage de `getStatementsRepo.js`.
- Authentification (`lib/helpers/statementForwarding.js`) :
  - `token` : `Authorization: Bearer <secret>` ;
  - `basic auth` : `Basic base64(user:pass)`.
- En-têtes personnalisés fusionnés. `X-Experience-API-Version` vaut par défaut `statement.version`, sinon `1.0.3`.
- En cas de succès : `$addToSet completedForwardingQueue` et `$pull pendingForwardingQueue`.

**Étape 3 : échec et tentatives.**
- Ajout dans `failedForwardingLog` de `{timestamp, statementForwarding_id, message, errorInfo:{headers, responseBody, responseStatus, url}}`.
- Si `failedForwardingLog.length <= maxRetries`, republie dans `STATEMENT_FORWARDING_REQUEST_DELAYED_QUEUE`.
- Sinon, appelle `done(err)` : la file de dead-letter du fournisseur prend le relais.

**Bugs de logique :**
- Le compteur `failedForwardingLog.length` **n'est pas filtré par `statementForwarding_id`**. Les tentatives sont donc partagées entre toutes les destinations d'un même statement.
- Si `maxRetries` est indéfini, il n'y a aucune nouvelle tentative.

**Délai de nouvelle tentative** (`retryDelay: 900` s, `lib/services/queue/queueConfigFactory.js:9-23`) : il n'est effectif que sous **SQS** (`DelaySeconds`) et **Service Bus** (scheduling, mais cassé par un bug, cf. §2). Sous **bull, Pub/Sub et local, il est ignoré** : la nouvelle tentative est immédiate.

#### Batch deletion (`batchStatementDeletion.js`)

Payload : `{batchDeleteId}`.
1. Si `ENABLE_STATEMENT_DELETION` vaut false, le job est simplement acquitté.
2. Si l'heure courante est hors de la fenêtre définie dans `siteSettings` (`inWindow`, `lib/models/batchDelete.js:26`), le job est abandonné. Le scheduler le republiera à la prochaine fenêtre.
3. Verrou atomique par `findOneAndUpdate({processing:false, done:false} → processing:true)` sur la collection `batchDelete`.
4. Reconstruit le scope du **client** qui a lancé la suppression (`getScopeFilter`), puis évalue `parseQuery(filter)` avec ce scope.
5. Supprime au plus `pageSize` statements (1000 par défaut).
6. Met à jour `deleteCount`. Le job est terminé quand `deletedCount === 0` ; sinon il se republie dans `BATCH_STATEMENT_DELETION_QUEUE`.

**Bug de `inWindow` :** si l'heure ou la minute de début vaut 0, elle est lue comme « falsy » et la fenêtre est considérée comme absente.

#### Import personas (`importPersonaHandler.js`)

1. Payload : `{index, data (ligne CSV), personaImportId, structure, organisation}`. Le traitement appelle `lib/services/importPersonas/importPersona.js`.
2. Valide les IFI. Une erreur est enregistrée dans `importErrors` avec `processedCount++`.
3. Pose un verrou `importPersonasLock` (TTL logique de 120 s, `establishLock.js`).
4. `createUpdateIdentifierPersona` pour chaque IFI, puis `updatePersona` (nom, upsert), puis `mergePersona` et `reasignPersonaStatements` si plusieurs personas sont concernés.
5. `overwritePersonaAttribute`, puis mise à jour du cache query builder sur `persona.import.<clé>` (`updateQueryBuilderCache.js`).
6. Incrémente `processedCount` et `result.merged` ou `result.created`.
7. Quand `processedCount >= totalCount`, `finishedProcessing` passe `importStage` à `STAGE_IMPORTED`, renseigne `importedAt`, puis génère le CSV d'erreurs (`addErrorsToCsv` → stockage `personasCsvs/<id>-error.csv`).

**En cas d'exception, la ligne est republiée sans limite**, ce qui peut produire une boucle infinie.

#### Org usage tracker (`orgUsageTracker.js`)

Payload : `{}`.
1. Pour chaque organisation : `count` de ses statements (avec le hint d'index `{organisation:1,timestamp:-1,_id:1}`).
2. Échantillonnage `$sample` de 10 000 statements, avec `$out` vers `statementSamples`, puis `$match` org avec `$out` vers `statementOrgSamples`, puis `collection.stats().avgObjSize`.
3. Entre 5 et 10 échantillons sont pris, avec une tolérance de 5 %. Le résultat donne `ownEstimatedBytes`, cumulé dans l'arbre parent/enfant (`totalUsage.js`).
4. Écrit `organisation.usageStats.{RUN_DATETIME, HAS_CHILDREN, OWN_COUNT, OWN_ESTIMATED_BYTES, TOTAL_COUNT, TOTAL_ESTIMATED_BYTES}`, insère dans `orgUsageStats`, puis supprime les deux collections temporaires.

### 1.5 Tableau des queues

Nom physique : `${QUEUE_NAMESPACE}_<valeur>`. Si `QUEUE_NAMESPACE` est absent, le préfixe devient littéralement `undefined_…`.

| Constante (fichier) | **Valeur exacte, à conserver** | Producteurs | Consommateur | Payload | Options |
|---|---|---|---|---|---|
| `STATEMENT_QUEUE` (`lib/constants/statements.js:3`) | `STATEMENT_QUEUE` | worker (`wrapHandlerForStatement.js:20`) | `statementHandler` | `{statementId, status?}` | — |
| `STATEMENT_EXTRACT_PERSONAS_QUEUE` (l.4) | **`STATEMENT_PERSON_QUEUE`** | `addStatementToPendingQueues` (worker, CLI `requeueStatements`, `testStatementForwarding`, `testQueryBuilderCache`) | `extractPersonasHandler` | `{statementId}` | filtrée par `ALLOWED_WORKER_QUEUES` |
| `STATEMENT_QUERYBUILDERCACHE_QUEUE` (l.5) | `STATEMENT_QUERYBUILDERCACHE_QUEUE` | idem | `queryBuilderCacheHandler` | `{statementId}` | filtrée |
| `STATEMENT_FORWARDING_QUEUE` (l.6) | `STATEMENT_FORWARDING_QUEUE` | idem | `statementForwardingHandler` | `{statementId}` | filtrée |
| `STATEMENT_FORWARDING_REQUEST_QUEUE` (l.7) | **`STATEMENT_FORWARDING_REQEUST_QUEUE`** (faute de frappe d'origine) | `statementForwardingHandler` | `statementForwardingRequestHandler` | `{status, statement, statementForwarding}` | `deadLetter` = `<NS>_STATEMENT_FORWARDING_DEADLETTER_QUEUE` |
| `STATEMENT_FORWARDING_REQUEST_DELAYED_QUEUE` (l.8) | `STATEMENT_FORWARDING_REQUEST_DELAYED_QUEUE` | `statementForwardingRequestHandler` (en cas d'échec) | idem | idem | `deadLetter` identique, `retryDelay` 900 s |
| `STATEMENT_FORWARDING_DEADLETTER_QUEUE` (l.9) | `STATEMENT_FORWARDING_DEADLETTER_QUEUE` | le fournisseur (bull : événement `failed` ; SQS : redrive `maxReceiveCount:1` ; Service Bus : sender ; Pub/Sub : `sendDeadLetter`) | `statementForwardingDeadLetterHandler` | `{statement, statementForwarding}` | — |
| `BATCH_STATEMENT_DELETION_QUEUE` (`lib/constants/batchDelete.js`) | `BATCH_STATEMENT_DELETION_QUEUE` | API `BatchDeleteController.js:63`, scheduler `cli/src/scheduler/batchDelete.js:45`, worker (auto-republication) | `batchStatementDeletion` | `{batchDeleteId}` | `visibilityTimeout` 3600 s |
| `EMAIL_EXPIRATION_NOTIFICATION_QUEUE` (`lib/constants/expirationNotifications.js`) | `EMAIL_EXPIRATION_NOTIFICATION_QUEUE` | CLI `expirationNotificationEmails` (scheduler toutes les 15 min) | `expirationNotification` | `{organisationId, emailType}` | — |
| `PERSONA_IMPORT_QUEUE` (`lib/constants/personasImport.js:50`) | `PERSONA_IMPORT_QUEUE` | **API** (`lib/services/importPersonas/importPersonas.js:70`, exécuté dans le processus API), worker (nouvelle tentative) | `importPersonaHandler` | `{index, data, personaImportId, structure, organisation}` | — |
| `ORG_USAGE_TRACKER_QUEUE` (`lib/constants/orgUsageTracker.js`) | `ORG_USAGE_TRACKER_QUEUE` | CLI `orgUsageTracker` (scheduler, 3 h du matin) | `orgUsageTracker` | `{}` | `visibilityTimeout` 3600 s |
| Signal Redis hors abstraction | liste `{REDIS_PREFIX}:statement.new`, canal `{REDIS_PREFIX}:statement.notify` | **xapi-service** (externe) | `listenForRedisPublish` | `{"statementId":"<uuid>"}` | — |

---

## 2. Abstraction des queues (`lib/services/queue/*`)

### 2.1 Façade : `index.js`

**Sélection du fournisseur** par `QUEUE_PROVIDER` (l.15-26) :
- `PUBSUB` ;
- `SQS` ;
- `SERVICE_BUS` ;
- `REDIS` ou `BULL` (même fournisseur bull) ;
- `LOCAL`.

Toute autre valeur, **y compris une variable absente**, lève une erreur.

**Nommage :** `getPrefixedQueueName = `${QUEUE_NAMESPACE}_${queueName}`` (l.29, dupliqué dans `queueConfigFactory.js:11`).

**API exposée :**
- `publish({queueName, payload}, cb)` : renvoie une Promise et accepte aussi un callback ;
- `subscribe({queueName, handler, onProcessed}, cb)` ;
- `unsubscribeAll()`.

Avant de transmettre au fournisseur, la façade ajoute `queueConfigFactory(queueName)` : `deadLetter`, `retryDelay`, `visibilityTimeout`.

**Contrat des handlers :** `handler(payload, done)` en style callback, où `done(err)` signale un échec.

**Sérialisation :** `JSON.stringify(payload)`. Les ObjectId et les dates deviennent des chaînes.

### 2.2 bull / Redis (`bull/index.js`)

- Un `new Queue(nomPréfixé, { createClient: redis.createClient })` par queue. Le même client ioredis sert pour `client`, `subscriber` et `bclient`.
- **Clés Redis :** préfixe bull par défaut `bull:<NS>_<QUEUE>:*`. `REDIS_PREFIX` n'est **pas** appliqué aux queues.
- **Publication :** `queue.add(payload, {removeOnFail:false, removeOnComplete:false})`. Les jobs sont ensuite supprimés manuellement (`job.remove()`) sur les événements `completed` et `failed`.
- **Aucune option `attempts` ni `backoff`.**
- **Traitement :** `queue.process((job, done) => handler(job.data, done))`. La concurrence bull par défaut est de 1 job à la fois par queue et par processus.
- **Dead-letter :** sur `failed`, `job.data` est ajouté à la queue nommée par `deadLetter`.
- **`retryDelay` et `visibilityTimeout` ne sont pas gérés.**
- **Bug :** le `.catch` de `publish` journalise l'erreur mais n'appelle jamais `done(err)`.

### 2.3 SQS (`sqs/index.js`)

- **Client :** aws-sdk v2. `AWS.config.update` est appelé à l'import avec `AWS_SQS_DEFAULT_REGION`, `AWS_SQS_ACCESS_KEY_ID` et `AWS_SQS_SECRET_ACCESS_KEY`.
- **Création automatique des queues** (`getQueueUrl`) :
  - `createQueue` sur le nom préfixé ;
  - `RedrivePolicy {maxReceiveCount:1, deadLetterTargetArn}` si une dead-letter est définie ;
  - `DelaySeconds` si `retryDelay` est défini ;
  - `VisibilityTimeout` si défini ;
  - `setQueueAttributes` si la queue existe déjà.
- **Publication :** regroupement par highland (`batchWithTimeOrCount(50 ms, 10)`), puis `sendMessageBatch`. `MessageBody` contient le JSON.
- **Consommation :** `sqs-consumer` v3 (`sqsConsumer.create({queueUrl, handleMessage, sqs})`).
- **Comportement en erreur :** `process.exit()` sur l'événement `error`. Un `done(err)` laisse le message en place, puis le redrive l'envoie vers la DLQ.

### 2.4 Google Pub/Sub (`pubsub/index.js`)

- **Version :** `@google-cloud/pubsub` 0.16 (fabrique `pubSub({keyFilename, projectId})`).
- **Topic :** nom préfixé, créé si absent.
- **Subscription :** `${PUBSUB_GOOGLE_CLOUD_SUBSCRIPTION_NAME||'ll'}_${nomPréfixé}`, créée si absente.
- **Publication :** `topic.publisher().publish(Buffer JSON)`.
- **Traitement :** `ack` en cas de succès. En cas d'échec : `nack`, ou publication dans le topic dead-letter puis `ack`.
- **Bug :** `publish` appelle `done` deux fois en cas d'erreur.

### 2.5 Azure Service Bus (`serviceBus/index.js`)

- **Paquets :** `@azure/service-bus` 1.x et `azure-sb` (pour `createQueueIfNotExists`). Connexion `SERVICE_BUS_ENDPOINT`.
- **`LockDuration`** = min(`visibilityTimeout`, 300 s).
- **Réception :** `peekLock` avec renouvellement du verrou.
- **En cas d'erreur :** envoi de `{...payload, error}` dans la queue dead-letter, puis `complete()`.

**Bugs :**
- `sender.schedualMessage` (l.143) est une faute de frappe de `scheduleMessage`. Toute publication dans la queue « delayed » plante sous ce fournisseur.
- `onProccessed` (faute de frappe) n'est jamais branché.

### 2.6 Local (`local/index.js`)

File en mémoire du processus (Immutable). Utilisable seulement en test : les messages publiés par l'API ou la CLI n'atteignent pas le worker.

---

## 3. Autres services `lib/services/*`

### persona (`lib/services/persona/`)

| Fichier | Rôle |
|---|---|
| `asignIdentifierToStatements.js` | `updateMany` `personaIdentifier` et `person` sur les statements correspondant à l'IFI. |
| `reasignPersonaStatements.js` | Réaffecte `person._id` et `person.display` après une fusion. |
| `identifierHasStatements.js` | Indique si des statements existent pour un identifiant. |
| `setupIfi.js`, `validateIfi.js` | Préparation et validation des IFI. |
| `utils/getIfiFromActor.js`, `utils/getActorFilterFromIfi.js` | Conversion acteur ↔ IFI ↔ filtre Mongo. |

**Il n'y a pas d'`index.js`.** Par conséquent `lib/services/files/uploadPeople.js`, qui importe `addCSVToQueue` depuis `lib/services/persona`, est du **code mort et cassé** : rien ne l'importe.

### importPersonas (`lib/services/importPersonas/`)

**Flux API :**
1. `uploadPersonas.js` : upload, scan ClamAV, stockage `personasCsvs/<id>.csv`, lecture des en-têtes et de la structure, étape `STAGE_CONFIGURE_FIELDS`.
2. `importPersonas.js` :
   - partie courte : passe en `STAGE_PROCESSING` ;
   - partie longue, exécutée **dans le processus API sans être attendue** : lecture du CSV depuis le stockage avec fast-csv, publication d'**un message par ligne** dans `PERSONA_IMPORT_QUEUE`, mise à jour de `totalCount`.
3. Le traitement côté worker est décrit au §1.4.

**Point technique :** `updateQueryBuilderCache.js:58-68` lit des **internes du driver Mongo** (`batch.s.currentBatch.operations`).

### querybuildercache (`lib/services/querybuildercache/`)

- `getCachesFromStatement`, `saveCachePaths`, `saveCacheValues`, `saveCaches`, `getCachesFromIdent` et `addIdentsToCache` : utilitaires de construction du cache.
- `generateQueryBuilderCaches` : appelé par l'API `StatementMetadataController.js:33,58` pour les métadonnées.

### statements (`lib/services/statements/`)

- `aggregate.js` : gère les dashboards partagés sécurisés par JWT (`filterJwtSecret`).
- `aggregateAsync.js` et `countStatements.js` s'appuient sur `lib/models/statement.js`.

**Cache Redis des agrégations** (`lib/models/statement.js:229-441`) :
- agrégation synchrone : clés `{prefix}:{org}-AGGREGATION-{sha1(pipeline)}-{skip}-{limit}-DATA` et `-RUNNING`, avec `setex AGGREGATION_CACHE_SECONDS` ;
- agrégation asynchrone : `…-AGGREGATION-ASYNC-…-STARTED-AT`, `-COMPLETED-AT`, `-RESULTS` et `-QUERY-RUNNING`.

### files (`lib/services/files/`)

**Choix du stockage** (`storage/index.js`) selon `FS_REPO` :
- `local` (valeur par défaut) ;
- `amazon` (pkgcloud) ;
- `google` (`@google-cloud/storage` 1.x) ;
- `azure` (`@azure/storage-blob` 10.x) ;
- `rackspace` (pkgcloud).

Tous les modules de stockage sont **importés au démarrage**, et les clients pkgcloud et GCS sont alors instanciés.

**Chemins :**
- local : `<FS_LOCAL_ENDPOINT|cwd>/<FS_SUBFOLDER|storage>/<clé>` ;
- cloud : `<FS_SUBFOLDER|storage>/<clé>`.

**Clés utilisées :**
- `downloads/<ts>-<org>-<uuid>.csv` (`exportStatements.js`, exécuté dans le processus API, rend la main au bout de 2 s) ;
- `logos/<orgId>` (`uploadLogo.js`) ;
- `personasCsvs/<id>.csv` et `<id>-error.csv`.

Le champ `upload.repo`/`logo.repo` des documents enregistre `FS_REPO`.

**Fichiers temporaires d'upload :** `${cwd}/storage/tmp` est codé en dur (`api/src/controllers/utils/getFileFromRequest.js:6`, multiparty).

**Code mort :** `lib/connections/multer.js` (non utilisé).

**Pièces jointes pour le forwarding** (`getStatementsRepo.js`) :
- stockage local `<endpoint>/<FS_SUBFOLDER|storage>/statements` ;
- `amazon` est converti en `s3` ;
- **Azure n'est pas pris en charge** ;
- **bug :** `defaultTo('statements', SUB_FOLDER_STATEMENTS)` a ses arguments inversés, donc la variable est toujours ignorée.

### email

**Transport :** `lib/connections/nodemailer.js` (nodemailer 2.7, `createTransport(smtpConfig)`). Si `TESTING` est défini, un faux mailer est utilisé.

**Helpers :** `lib/helpers/email.js`.

**Templates :** `lib/templates/emails/*.html` au format `_.template` de lodash. Ils sont lus **depuis le cwd** (`./lib/templates/...`) : le répertoire `lib/templates` doit donc être présent à l'exécution.

| Template | Variables | Déclencheur |
|---|---|---|
| `body.html` | `title`, `body`, `siteUrl` | Gabarit enveloppant tous les mails |
| `newUserReset.html` | `resetLink` | `sendNewUser`, depuis `lib/models/user.js` |
| `requestPasswordReset.html` | `user`, `resetLink` | `sendResetPasswordToken`, depuis l'API `AuthController` |
| `organisationAboutToExpire.html` | `name`, `expiration` | Worker |
| `organisationExpired.html` | `name` | Worker |
| `requestAppAccess.html` | `email`, `orgId`, `llHost`, `appConfig` | `RequestAppAccessController`. Destinataire codé en dur : `hello@learninglocker.net` |

---

## 4. CLI (`cli/`)

**Entrées :**
- `cli/src/server.js` (commander 2), compilé en `cli/dist/server/index.js` ;
- `cli/src/scheduler.js`, compilé en `cli/dist/scheduler/index.js`.

**Syntaxe :** `node cli/dist/server <commande> [args] [options]`, **depuis la racine du dépôt** (`.env`, templates).

| Commande | Syntaxe | Rôle (fichier) |
|---|---|---|
| `clearAggregationCache` | `clearAggregationCache [-o, --org <id>]` | Supprime par `KEYS`/`DEL` les clés Redis `{prefix}:*-AGGREGATION-*`. **Bug :** le code lit `options.orgId` alors que l'option déclarée est `--org`, donc **toutes** les organisations sont toujours purgées (`commands/clearAggregationCache.js`). |
| `bulkInsert` | `bulkInsert [host] [username] [password] [total] [batchSize]` | Génère des statements factices (faker, tincanjs) vers un endpoint xAPI. Outil de test de charge. |
| `createSiteAdmin` | `createSiteAdmin [email] [organisation] [password] [-f, --forceUpdatePassword]` | Crée le document `siteSettings` s'il manque, crée ou trouve l'utilisateur (scope `SITE_ADMIN`) et l'organisation, et ajoute le scope `ALL` dans les `organisationSettings`. |
| `updateStatementCount` | `updateStatementCount` | Recalcule `lrs.statementCount` (`countDocuments`). |
| `requeueStatements` | `requeueStatements [lrs_id] [-s, --since <ISO date>]` | Remet les statements dans les queues 1.3 non complétées (`addStatementToPendingQueues`), par lots de 100. La procédure de retraitement complet est documentée en commentaire dans `server.js:72-76`. |
| `migrateV1-LRS` | `migrateV1-LRS [orgId]` | Migration v1 (`v1-migrations/migrateLRS.js`, appelle `updateClientOrganisation`). |
| `migrateVisualiseQueries` | — | Encapsule les filtres des visualisations dans `{match}` (v1). |
| `updateStatementOrganisation` | — | Copie `lrs.organisation` dans `statements.organisation`. |
| `migrateToOrgSettings` | — | Migre les réglages utilisateur par organisation (utilise `.stream()` Mongoose). |
| `migrateTimestamps` | — | Ajoute `createdAt`/`updatedAt` manquants (v1). |
| `migrateClientAuthority` | — | Migration v1 des clients. |
| `migrateClientId` | — | Migration v1 de `client` dans les statements. |
| `migrateExportsToCSV` | — | Ajoute le suffixe `.csv` aux URL de `downloads`. |
| `migrateScopesToRoles` | — | Crée les rôles Admin et Observer par organisation et migre les utilisateurs. |
| `migrateXAPIReadScope` | — | Migration v1 des scopes xAPI des clients. |
| `migrateDownloadPaths` | — | Réécrit `download.url` en `/api/organisation/<org>/downloadexport/<id>.csv`. |
| `migrateVisualiseAxes` | — | Déplace `axes` à la racine des visualisations. |
| `migrateQueryBuilderCachesPath` | — | Crée les sous-chemins de `queryBuilderCaches`. |
| `migrateToInQueries` / `migrateFromInQueries` | — | Conversion des requêtes `$in` dans dashboards, statementForwarding, visualisations, utilisateurs et queries. Aussi incluse dans la migration v2 `20190307130000`. |
| `testStatementForwarding` | `testStatementForwarding [statementId] [-p, --port <port>]` | Retire `STATEMENT_FORWARDING_QUEUE` des files du statement, le republie et démarre en option un serveur HTTP de réception. Nécessite un worker actif. |
| `testQueryBuilderCache` | `testQueryBuilderCache` | Rejoue le statement dans la queue QBC. **Bug :** l'argument `[statementId]` n'est pas déclaré, c'est l'objet Command qui est reçu (et l. 20-23 filtrent `completedQueues` au lieu de `processingQueues`). |
| `seed` | `seed [reset\|getToken]` | Exige `RUNTIME_NODE_ENV=test`. `reset` supprime la base, lance les migrations et crée `test@learningpool.com`. `getToken` affiche des cookies JWT. |
| `batchJobs` | `batchJobs [-j, --job querybuildercache\|personas] [-f, --from <date>] [-t, --to <date>] [-o, --org <id>] [-l, --lrs <id>] [-b, --batchSize <n>]` | Traitement en lot, **hors queues**, via `worker/handlers/statement/batcher.js`. Filtre sur `stored`. `--org` est prioritaire sur `--lrs`. Taille de lot 1000 par défaut. |
| `disableRegister` | — | `siteSettings.dontShowRegistration = true` (upsert). |
| `migrateMongo` | `migrateMongo [-u, --up [clé\|next]] [-d, --down <clé\|last>] [-i, --info [v\|verbose]] [-f, --fixOrder]` | Migrations v2 (`cli/src/migrateMongo/*`, suivi dans la collection **`migrations`** `{key, upFn, order}`). Scripts npm : `yarn migrate` (`--up`) et `yarn rollback` (`--down last`). |
| `expirationNotificationEmails` | `expirationNotificationEmails [--weekBefore <ISO>]` | Repère les organisations qui expirent dans les 7 jours ou déjà expirées (`expirationNotifications.* = EMAIL_NOOP`), publie dans `EMAIL_EXPIRATION_NOTIFICATION_QUEUE` et passe l'état à `EMAIL_PROCESSING`. |
| `orgUsageTracker` | `orgUsageTracker` | Publie `{}` dans `ORG_USAGE_TRACKER_QUEUE`. |

**Fichiers non enregistrés comme commandes :**
- `fixTypoLast1Years.js`, `migrateCuratr*.js` et `migrateVizTypesOfTemplates.js` sont utilisés par les migrations v2 ;
- `updateClientOrganisation.js` est utilisé par `migrateLRS` ;
- `verifyJiscRelations.js` est **mort** : il importe `lib/plugins/jisc_1_2_6`, qui n'existe pas.

### Migrations v2 (`cli/src/commands/v2-migrations/index.js`)

L'ordre est celui de l'`OrderedMap`. **Il est vérifié contre la collection `migrations`** (`checkRunMigrations`) : il faut conserver les clés et leur ordre.

1. `20171122100800_common_indexes`
2. `20171121153300_update_refs`
3. `20171008104700_personas_indexes` (`personaService.migrate()`)
4. `20171127214900_migrate_identifiers`
5. `20180320093000_shareable_dashboards`
6. `20180411160000_site_settings`
7. `20180212_expiration`
8. `20190131000000_oauth_tokens` (TTL `expireAt`)
9. `20190212150000_personaAttributes_indexes`
10. `20190307130000_migrate_to_in_queries`
11. `20190509000000_migrate_null_resetTokens`
12. `20190711090000_persona_imports`
13. `20190627000000_fix_typo_last_1_years`
14. `20190719000000_migrate_viz_types_of_templates`
15. `20200227000000_rename_curatr_vis_tpl_types_to_stream`
16. `20200228000000_rename_curatr_dashboards_to_stream`

`20171128144900_remove_old_idents.js` existe mais n'est pas enregistrée.

### Scheduler (`cli/src/scheduler.js` → `cli/dist/scheduler`)

Les verrous Redis `SET NX EX` permettent de lancer plusieurs instances sans doublon.

| Tâche | Périodicité | Verrou Redis | Action |
|---|---|---|---|
| Expiration | Toutes les 15 min (`setTimeout` recalé), première exécution au démarrage | `{prefix}:EXPIRATION_SCHEDULER:RUNNING`, 30 s | `expirationNotificationEmails({dontExit:true})` |
| Org usage | Tous les jours à **3 h, heure locale du serveur** (puis toutes les 24 h) | `{prefix}:ORG_USAGE_SCHEDULER:RUNNING`, 3600 s | `orgUsageTracker` → queue |
| Batch delete (`scheduler/batchDelete.js`) | Au démarrage, puis au début de la fenêtre suivante (`nextRunAtDateTime(siteSettings)`) | `{prefix}:BATCH_STATEMENT_DELETION_SCHEDULER:RUNNING`, 30 s | Si dans la fenêtre, publie tous les `batchDelete` avec `done:false, processing:false`. Ne fait rien si `ENABLE_STATEMENT_DELETION` vaut false. |

---

## 5. Configuration

### 5.1 Inventaire des variables d'environnement

Ce tableau constitue le **contrat de configuration**. Les chemins sont relatifs à la racine du dépôt.

Abréviations :
- composants : API, UI (serveur ou client), WK (worker), CLI (commandes et scheduler), BLD (build), T (tests) ;
- colonne « .env.ex » : « oui » = présente et active, « c » = présente en commentaire, « non » = absente.

#### Général, HTTP et sécurité

| Variable | Défaut | Fichier:ligne | Composants | .env.ex |
|---|---|---|---|---|
| `NODE_ENV` | **Figée au build** par DefinePlugin : `"production"` avec `--release`, sinon `"development"`. La valeur de `.env` n'agit que sur les `node_modules` externes au runtime et sur l'environnement babel au build. | `ui/src/config.js:6`, `ui/src/client.js:46`, `ui/src/dashboards/client.js:41`, `lib/tools/getWebpackConfig.js:204,295` | UI, BLD | oui (`production`) |
| `RUNTIME_NODE_ENV` | — ; `test` charge `.env.test` | `lib/tools/getWebpackConfig.js:61` (bannière), `cli/src/seed/index.js:52` | tous, CLI | non |
| `SITE_URL` | — | `lib/helpers/email.js:16,47,75,100,127`, `api/src/auth/passport.js:208`, `api/src/controllers/RequestAppAccessController.js:30`, `ui/src/server.js:95`, `ui/src/controllers/renderDashboard.js:71` | API, WK, UI | oui |
| `APP_SECRET` | **aucun** | `api/src/auth/jwt.js:72`, `api/src/auth/passport.js:74`, `api/src/controllers/AuthController.js:207` | API | oui (vide). **À conserver tel quel**, sinon les JWT existants deviennent invalides. |
| `API_PORT` | — (obligatoire : l'API journalise une erreur et n'écoute pas) | `api/src/server.js:26-35`, `ui/src/config.js:25` (cible du proxy UI) | API, UI | oui (8080) |
| `API_HOST` | `127.0.0.1` | `ui/src/config.js:24`, `api/src/server.js:35` (log) | UI | c |
| `UI_PORT` | — (repli sur `PORT`) | `ui/src/config.js:9`, `lib/tools/getWebpackConfig.js:31` | UI, BLD | oui (3000) |
| `PORT` | — | `ui/src/config.js:9` | UI | non |
| `UI_HOST` | `127.0.0.1` | `ui/src/config.js:7`, `lib/tools/getWebpackConfig.js:37` (publicPath en debug) | UI, BLD | c |
| `ENABLE_FRAMEGUARD` | `true` | `ui/src/config.js:8` | UI | c |
| `COOKIE_DOMAIN` | — ; le motif `HOSTNAME` est remplacé par `location.hostname` | `ui/src/utils/auth.js:21-22`, **injectée dans le bundle client au build** : `lib/tools/getWebpackConfig.js:208-209` | UI, BLD | c |
| `ENABLE_REACT_DEVTOOLS` | `false` (au build) | `lib/tools/getWebpackConfig.js:30` | BLD | c |
| `RESTRICT_CREATE_ORGANISATION` | `true` | `ui/src/controllers/renderApp.js:26`, `lib/services/auth/canCreateOrganisations.js:8`, `lib/services/auth/modelFilters/organisation.js:105` | UI, API | c |
| `ENABLE_STATEMENT_DELETION` | `true` | `api/src/controllers/BatchDeleteController.js:19`, `api/src/routes/HttpRoutes.js:376`, `ui/src/controllers/renderApp.js:27`, `lib/constants/scopes.js:36` (valeur brute, non convertie en booléen), `lib/services/auth/modelFilters/batchDelete.js:10`, `cli/src/scheduler/batchDelete.js:24`, `worker/src/handlers/batchStatementDeletion/batchStatementDeletion.js:33` | API, UI, CLI, WK | c |
| `JWT_ACCESS_TOKEN_EXPIRATION` | `1h` | `lib/constants/auth.js:36` | API | c |
| `JWT_REFRESH_TOKEN_EXPIRATION` | `7d` | `lib/constants/auth.js:37` | API | c |
| `GOOGLE_ENABLED` | — | `api/src/auth/passport.js:199`, `api/src/routes/HttpRoutes.js:90` (booléen), `:141` (test de vérité : la chaîne `"false"` est vraie) | API | oui (`false`) |
| `GOOGLE_CLIENT_ID` | — | `api/src/auth/passport.js:200,206` | API | c |
| `GOOGLE_CLIENT_SECRET` | — | `api/src/auth/passport.js:201,207` | API | c |

#### MongoDB et agrégations

| Variable | Défaut | Fichier:ligne | Composants | .env.ex |
|---|---|---|---|---|
| `MONGODB_PATH` | — | `lib/connections/mongoose.js:19`, `lib/connections/personaService.js:14` | tous | oui |
| `MONGO_CONNECTION_POOLSIZE` | 20 | `lib/connections/mongoose.js:13` | tous | c |
| `MONGO_SOCKET_TIMEOUT_MS` | 300000 | `lib/connections/mongoose.js:15` | tous | c |
| `MONGODB_TEST_PATH` | — | `api/testConfig.js:12`, `worker/testConfig.js:12`, `cli/testConfig.js:12`, `tests.babel:3` | T | oui |
| `MAX_TIME_MS` | 0 | `api/src/controllers/StatementController.js:8`, `lib/models/statement.js:35`, `lib/models/plugins/addCRUDFunctions.js:13-14` | API | c |
| `ALLOW_AGGREGATION_DISK_USE` | `true` | `lib/models/statement.js:28` | API | c |
| `AGGREGATION_CACHE_SECONDS` | 300 | `lib/models/statement.js:29` | API | c |
| `AGGREGATION_REFRESH_AT_SECONDS` | 120 | `lib/models/statement.js:30` | API | c |
| `ASYNC_AGGREGATION_WAITING_MS` | 0 | `lib/models/statement.js:31` | API | c |
| `ASYNC_AGGREGATION_CACHE_SECONDS` | 604800 | `lib/models/statement.js:32` | API | c |
| `ASYNC_AGGREGATION_TIMEOUT_MS` | 0 | `lib/models/statement.js:33` | API | c |
| `ASYNC_AGGREGATION_REFRESH_AFTER_SECONDS` | 60 | `lib/models/statement.js:34` | API | c |

#### Redis

| Variable | Défaut | Fichier:ligne | Composants | .env.ex |
|---|---|---|---|---|
| `EVENTS_REPO` | `redis` ; valeur alternative `sentinel` | `lib/connections/redis.js:11`, `worker/.../getStatementsRepo.js:18` | tous | **non** |
| `REDIS_URL` | — (prioritaire sur les autres) | `lib/connections/redis.js:25-26` | tous | oui |
| `REDIS_HOST` | — (localhost par défaut dans ioredis) | `lib/connections/redis.js:30` | tous | c |
| `REDIS_PORT` | 6379 | `lib/connections/redis.js:31` | tous | c |
| `REDIS_DB` | 0 | `lib/connections/redis.js:28` | tous | c |
| `REDIS_PASSWORD` | — | `lib/connections/redis.js:29` | tous | **non** |
| `REDIS_PREFIX` | — (aucun préfixe) | `lib/helpers/cachePrefix.js:2`, `getStatementsRepo.js:21,25` | tous ; doit être **identique dans l'xapi-service** | oui (`LEARNINGLOCKER`) |
| `SENTINEL_DB` | 0 | `lib/connections/redis.js:14` | tous | non |
| `SENTINEL_PASSWORD` | — | `lib/connections/redis.js:15` | tous | non |
| `SENTINEL_NAME` | `mymaster` | `lib/connections/redis.js:16` | tous | non |
| `SENTINEL_CONNECTIONS` | `127.0.0.1:6379` (liste `hôte:port` séparés par des espaces) | `lib/connections/redis.js:17` | tous | non |

#### Queues

| Variable | Défaut | Fichier:ligne | Composants | .env.ex |
|---|---|---|---|---|
| `QUEUE_PROVIDER` | **aucun** (erreur si absent) : `REDIS`, `BULL`, `SQS`, `PUBSUB`, `SERVICE_BUS`, `LOCAL` | `lib/services/queue/index.js:15` | API, WK, CLI | oui (`REDIS`) |
| `QUEUE_NAMESPACE` | — (préfixe `undefined_`) | `lib/services/queue/index.js:29`, `lib/services/queue/queueConfigFactory.js:11` | API, WK, CLI | oui (`DEV`) |
| `ALLOWED_WORKER_QUEUES` | absente = toutes ; vide = aucune | `worker/src/handlers/statement/allowedWorkerQueues.js:48` | WK (et CLI via `requeueStatements`) | c |
| `AWS_SQS_DEFAULT_REGION` | — | `lib/services/queue/sqs/index.js:19` | API, WK, CLI | c |
| `AWS_SQS_ACCESS_KEY_ID` | — | `lib/services/queue/sqs/index.js:20` | idem | c |
| `AWS_SQS_SECRET_ACCESS_KEY` | — | `lib/services/queue/sqs/index.js:21` | idem | c |
| `PUBSUB_GOOGLE_CLOUD_KEY_FILENAME` | — | `lib/services/queue/pubsub/index.js:13` | idem | c |
| `PUBSUB_GOOGLE_CLOUD_PROJECT_ID` | — | `lib/services/queue/pubsub/index.js:14` | idem | c |
| `PUBSUB_GOOGLE_CLOUD_SUBSCRIPTION_NAME` | `ll` | `lib/services/queue/pubsub/index.js:19` | idem | c |
| `SERVICE_BUS_ENDPOINT` | — | `lib/services/queue/serviceBus/index.js:17` | idem | c |

#### Stockage de fichiers

| Variable | Défaut | Fichier:ligne | Composants | .env.ex |
|---|---|---|---|---|
| `FS_REPO` | `local` | `lib/services/files/storage/index.js:9`, `lib/services/files/exportStatements.js:58`, `lib/services/files/uploadLogo.js:20`, `getStatementsRepo.js:35` | API, WK | oui |
| `FS_SUBFOLDER` | `storage` | `storage/local.js:10`, `storage/google.js:9`, `storage/azure.js:19`, `storage/pkgcloud.js:8`, `getStatementsRepo.js:8,40,55` | API, WK | c |
| `FS_LOCAL_ENDPOINT` | `process.cwd()` | `storage/local.js:9`, `getStatementsRepo.js:7` | API, WK | c |
| `SUB_FOLDER_STATEMENTS` | ignorée (bug, toujours `statements`) | `getStatementsRepo.js:9` | WK | non |
| `FS_AWS_S3_ACCESS_KEY_ID` | — | `storage/amazon.js:10`, `getStatementsRepo.js:47` | API, WK | c |
| `FS_AWS_S3_SECRET_ACCESS_KEY` | — | `storage/amazon.js:11`, `getStatementsRepo.js:50` | API, WK | c |
| `FS_AWS_S3_REGION` | — | `storage/amazon.js:12`, `getStatementsRepo.js:49` | API, WK | c |
| `FS_AWS_S3_BUCKET` | — | `storage/amazon.js:15`, `getStatementsRepo.js:54` | API, WK | c |
| `FS_GOOGLE_CLOUD_KEY_FILENAME` | — | `storage/google.js:6`, `getStatementsRepo.js:38` | API, WK | c |
| `FS_GOOGLE_CLOUD_PROJECT_ID` | — | `storage/google.js:7`, `getStatementsRepo.js:39` | API, WK | c |
| `FS_GOOGLE_CLOUD_BUCKET` | — | `storage/google.js:8`, `getStatementsRepo.js:37` | API, WK | c |
| `FS_AZURE_ACCOUNT` | — | `storage/azure.js:15` | API, WK | c |
| `FS_AZURE_ACCOUNT_KEY` | — | `storage/azure.js:16` | API, WK | c |
| `FS_AZURE_CONTAINER_NAME` | — | `storage/azure.js:17` | API, WK | c |
| `FS_RACK_USERNAME` | — | `storage/rackspace.js:10` | API, WK | **non** |
| `FS_RACK_API_KEY` | — | `storage/rackspace.js:11` | API, WK | non |
| `FS_RACK_REGION` | — | `storage/rackspace.js:12` | API, WK | non |
| `FS_RACK_USE_INTERNAL` | — | `storage/rackspace.js:13` | API, WK | non |
| `FS_RACK_CONTAINER` | — | `storage/rackspace.js:16` | API, WK | non |

Les chemins `storage/*` ci-dessus sont sous `lib/services/files/`. `getStatementsRepo.js` est sous `worker/src/handlers/statement/statementForwarding/`.

#### Mail

| Variable | Défaut | Fichier:ligne | Composants | .env.ex |
|---|---|---|---|---|
| `SMTP_HOST` | — | `lib/connections/nodemailer.js:7` | API, WK | c |
| `SMTP_PORT` | — | `lib/connections/nodemailer.js:8` | API, WK | c |
| `SMTP_SECURED` | `false` | `lib/connections/nodemailer.js:9` | API, WK | c |
| `SMTP_IGNORE_TLS` | `false` | `lib/connections/nodemailer.js:10` | API, WK | c |
| `SMTP_REQUIRE_TLS` | `false` | `lib/connections/nodemailer.js:11` | API, WK | c |
| `SMTP_AUTH_REQUEST` | `true` | `lib/connections/nodemailer.js:15` | API, WK | c |
| `SMTP_USER` | — | `lib/connections/nodemailer.js:21` | API, WK | c |
| `SMTP_PASS` | — | `lib/connections/nodemailer.js:22` | API, WK | c |
| `LL_FROM_NAME` | `Learning Locker` | `lib/helpers/email.js:11` | API, WK | c |
| `LL_FROM_EMAIL` | `noreply@learninglocker.net` | `lib/helpers/email.js:12` | API, WK | c |

#### Logs, monitoring et antivirus

| Variable | Défaut | Fichier:ligne | Composants | .env.ex |
|---|---|---|---|---|
| `LOG_MIN_LEVEL` | console : défaut winston (`info`) ; CloudWatch et API : `info` | `lib/logger.js:15,37`, `api/src/controllers/utils/handleRequestError.js:129` | tous | oui (`info`) |
| `LOG_DIR` | UI : `ui/logs` (`__dirname/../../logs`) ; New Relic : `logs` | `ui/src/server.js:34` (logs d'accès morgan à rotation quotidienne `access-%DATE%.log`), `lib/tools/newrelicConfig.js:4` | UI, API | oui (`logs`) |
| `COLOR_LOGS` | `false` | `lib/logger.js:10` | tous | oui (`true`) |
| `WINSTON_CLOUDWATCH_ENABLED` | `false` | `lib/logger.js:11` | tous | c |
| `WINSTON_CLOUDWATCH_LOG_GROUP_NAME` | `llv2` | `lib/logger.js:16` | tous | c |
| `WINSTON_CLOUDWATCH_LOG_STREAM_NAME` | `os.hostname()` | `lib/logger.js:17` | tous | c |
| `WINSTON_CLOUDWATCH_ACCESS_KEY_ID` | — | `lib/logger.js:21` | tous | c |
| `WINSTON_CLOUDWATCH_SECRET_ACCESS_KEY` | — | `lib/logger.js:22` | tous | c |
| `WINSTON_CLOUDWATCH_REGION` | — | `lib/logger.js:23` | tous | c |
| `NEW_RELIC_LICENSE_KEY` | — (active l'agent) | `lib/tools/newrelicConfig.js:3` (bannière API et UI uniquement) | API, UI | c |
| `NEWRELIC_API_NAME` | — | `lib/tools/newrelicConfig.js:11` | API | c |
| `NEWRELIC_UI_NAME` | — | `lib/tools/newrelicConfig.js:8` | UI | c |
| `NEW_RELIC_NO_CONFIG_FILE`, `NEW_RELIC_APP_NAME`, `NEW_RELIC_LOG`, `NEW_RELIC_LOG_LEVEL` | **écrites** par la bannière : `true`, nom selon l'app, `$LOG_DIR/newrelic-agent.log`, `info` | `lib/tools/newrelicConfig.js:5-19` | API, UI | non (internes) |
| `CLAMDSCAN_BINARY` | — (scan désactivé, simple warning) | `lib/services/files/clamscan.js:9,17` | API | c |
| `CLAMDSCAN_CONF` | `/etc/clamav/clamd.conf` | `lib/services/files/clamscan.js:18` | API | c |

#### Tests et variables internes

| Variable | Défaut | Fichier:ligne | Composants | .env.ex |
|---|---|---|---|---|
| `TESTING` | — (si vraie : faux mailer) | `lib/connections/nodemailer.js:29` ; positionnée par `*/testConfig.js:16` et `tests.babel` | T | non |
| `TEST_API_PORT` | — | `*/testConfig.js:13` | T | c (`808080`, valeur invalide) |
| `TEST_SMTP_PASS` | — | `*/testConfig.js:14` | T | non |
| `TEST_LOG_MIN_LEVEL` | — | `*/testConfig.js:15` | T | oui |
| `BROWSER` | figée au build (DefinePlugin) | `lib/tools/getWebpackConfig.js:207,296` | BLD | non |
| `DISABLE_PERSONA_SCORING` | — | **jamais lue dans ce dépôt** (présente dans `.env.example:92`). Peut-être lue par `@learninglocker/persona-service/dist/config` : à vérifier après `yarn install`. | ? | c |

**Remarques sur la configuration :**
- **Valeurs lues au build et non à l'exécution :** `NODE_ENV`, `COOKIE_DOMAIN` (bundle client), `ENABLE_REACT_DEVTOOLS`, et `UI_HOST`/`UI_PORT` pour le publicPath en debug. Modifier l'une d'elles impose de **recompiler**.
- **Chargement de `.env` :** il passe par la bannière webpack, `dotenv.config()` (dotenv 2), relatif au **cwd**. pm2 fixe `cwd: "."`. Toutes les apps lisent le même `.env`. Les variables déjà présentes dans l'environnement du processus sont prioritaires (comportement dotenv).
- **Variables non documentées dans `.env.example`, à ajouter à la documentation :** `EVENTS_REPO`, `REDIS_PASSWORD`, `SENTINEL_*`, `FS_RACK_*`, `SUB_FOLDER_STATEMENTS`, `PORT`, `RUNTIME_NODE_ENV`.
- **Configuration de l'xapi-service :** il a son propre `.env` dans son propre dépôt. Il doit partager `MONGODB_PATH`, Redis/`REDIS_PREFIX`/`EVENTS_REPO` et la configuration de stockage (`FS_*`), sinon les pièces jointes ne sont pas retrouvées pour le forwarding.

### 5.2 Connexions (`lib/connections/`)

| Fichier | Rôle |
|---|---|
| `mongoose.js` | Une connexion par namespace (`ll`), `mongoose.createConnection(MONGODB_PATH, {promiseLibrary: bluebird, socketTimeoutMS, poolSize})`. Options globales `useNewUrlParser`, `useFindAndModify:false`, `useCreateIndex:true` : elles sont supprimées ou deviennent des erreurs en Mongoose ≥ 6. |
| `redis.js` | ioredis : mode `sentinel` (`{db, password, name, sentinels}`) ou `redis` (`REDIS_URL` ou `{db, password, host, port}`). Utilisé par bull, le scheduler, les agrégations et `listenForRedisPublish`. |
| `nodemailer.js` | Voir §3 (email). |
| `personaService.js` | Voir §1.4 (Personas). |
| `multer.js` | Non utilisé. |
| `supertestApi.js` | Tests. |

### 5.3 pm2 (`pm2/*.json`)

**Fichiers disponibles :**

| Fichier | Contenu |
|---|---|
| `all.json` (`yarn start`) | API (`api/dist/server`), UIServer (`ui/dist/server`), Worker (`worker/dist/server`), Scheduler (`cli/dist/scheduler`) |
| `all.json.dist` | Identique, avec les placeholders `{INSTALL_DIR}`, `{LOG_DIR}`, `{PID_DIR}` |
| `server.json` / `webapp.json.dist` | API et UI seulement |
| `worker.json` / `worker.json.dist` | Worker et Scheduler, pour un déploiement séparé |
| `dev-all.json` | Surveille `*/dist` |
| `test-all.json` | `env.RUNTIME_NODE_ENV=test`, sans Scheduler |

**Paramètres communs :**
- `exec_mode: cluster`, `instances: 1` ;
- `wait_ready` et `listen_timeout` 30000 pour API, UI et Worker. Le Scheduler n'a pas `wait_ready` ;
- `node_args: --max-old-space-size=256 --max-semi-space-size=2` ;
- `watch: [".env"]` : toute modification de `.env` redémarre les processus ;
- logs dans `./logs/*_stdout.log` et `*_stderr.log`.

**Anomalie :** le Worker utilise `./pids/ui.pid`, comme l'UI.

### 5.4 nginx (`nginx.conf.example`)

**Placeholders :** `SITE_URL`, `SITE_ROOT`, `XAPI_PORT`, `API_PORT`, `UI_PORT`.

**Routes :**
- `~* ^/data/xAPI(.*)` → `127.0.0.1:XAPI_PORT/data/xAPI$1` (xapi-service) ;
- `= /api` et `~* ^/api(.*)` → `127.0.0.1:API_PORT$1` (préfixe retiré, en-têtes upgrade) ;
- `/` → `try_files $uri @node_server`, avec `root /SITE_ROOT/ui/dist/public` ;
- `@node_server` → `localhost:UI_PORT`.

**Autres réglages :**
- écoute sur le port 80 uniquement, sans TLS ;
- `client_max_body_size 20M` ;
- `large_client_header_buffers 4 256k`.

### 5.5 Pipeline de build (webpack 3 + babel 6)

**Scripts npm :** `build-<app>` lance `babel-node <app>/build --release`. `build-all` enchaîne `api/build`, `ui/buildServer`, `ui/buildClient`, `cli/build` et `worker/build`. Sans `--release`, le build est en mode debug ; `--watch`, `--verbose` et `--stats` sont aussi acceptés.

**`<app>/build.js` :**
- `import 'dotenv/config'` : `.env` est lu au build. La CI crée un `.env` vide.
- Puis `getWebpackConfig({...})` (`lib/tools/getWebpackConfig.js`) et `run(bundle)` (`lib/tools/bundle.js` : `compiler.run`, `compiler.watch`, ou `webpack-dev-middleware` sur le port 3131 pour l'UI client en debug).

**Sorties :**

| Build | Sortie |
|---|---|
| `api/build.js` | `api/dist/server/index.js` (+ `.map`, `assets.json`), bannière New Relic « API » |
| `ui/buildServer.js` | `ui/dist/server/index.js`, bannière New Relic « UI » |
| `ui/buildClient.js` | `ui/dist/public/` : `client.[chunkhash:8].js`, `vendor.[hash].js` (CommonsChunk), chunks, `assets.json`, copie de `ui/src/static` vers `static/` (UglifyJs en release) |
| `cli/build.js` | **deux bundles** : `cli/dist/server/index.js` et `cli/dist/scheduler/index.js` |
| `worker/build.js` | `worker/dist/server/index.js` |

`node <app>/dist/server` résout `index.js`.

**Configuration serveur :**
- `target: node`, `libraryTarget: commonjs2` ;
- `externals` : `webpack-node-externals`, sauf les fichiers non JS et `react-toolbox`, ainsi que `.env` et `assets.json`. **Les `node_modules` doivent donc être déployés.** ;
- `LimitChunkCountPlugin(1)` ;
- `node: {__dirname:false, …}` ;
- `devtool` : `source-map` (release) ou `cheap-module-source-map`.

**Bannière** (`BannerPlugin`, `raw`) :
1. chargement dotenv (`.env`, ou `.env.test` si `RUNTIME_NODE_ENV=test`) ;
2. bootstrap New Relic (API et UI uniquement) ;
3. `require("source-map-support").install()`.

**DefinePlugin :**
- serveur : `process.env.NODE_ENV`, `process.env.BROWSER=false`, `__CLIENT__: true` (sic), `__SERVER__: false`, `__DEVELOPMENT__`, `__DEVTOOLS__` ;
- client : `process.env.COOKIE_DOMAIN` en plus.

**Résolution :** alias `api`, `ui`, `worker`, `cli` → `<x>/src`, et `lib` → `lib/`. `modules: [sourceDir, racine, node_modules]`.

**Loaders :**
- `babel-loader` (`.babelrc`) ;
- CSS modules : `isomorphic-style-loader`/`style-loader` + `css-loader` + `postcss-loader` (`postcss.config.js` : autoprefixer, nesting, etc.) ;
- `.scss` : `sass-loader` → **node-sass** ;
- `raw-loader` (txt/md), `file-loader` et `url-loader` (médias).

**Plugins :**
- `HardSourceWebpackPlugin` (cache dans `<app>/src/node_modules/.cache`, d'où `clean-build-cache.sh`, lancé sur le hook husky `post-checkout`) ;
- `ModuleConcatenation`, `AssetsPlugin`, `CopyPlugin`, `LoaderOptionsPlugin` ;
- `StatsPlugin` (avec `--stats`).

**`.babelrc` :**
- presets `react`, `env` (`modules:false`), `stage-0` ;
- plugins `transform-runtime`, `es2015-destructuring`, `object-rest-spread`, `es2015-parameters`, `decorators-legacy`, `class-properties`, `syntax-dynamic-import` ;
- environnements : `development` (jsx-source/self), `production` (`react-optimize`), `test` (commonjs, `dynamic-import-node`).

**Fichiers legacy :**
- `server.babel` et `tests.babel` (babel-register et babel-polyfill, avec bluebird comme Promise) ne sont **référencés nulle part**.
- `lib/tools/copy.js` et `lib/tools/clean.js` (dossiers `build/`, `src/content`) sont inutilisés.

**Tests :**
- `mocha-webpack` avec `api|worker|cli/testConfig.js`, qui forcent `MONGODB_PATH=MONGODB_TEST_PATH`, `API_PORT=TEST_API_PORT`, `SMTP_PASS=TEST_SMTP_PASS`, `LOG_MIN_LEVEL=TEST_LOG_MIN_LEVEL` et `TESTING=true` ;
- UI : jest 19 avec `ui/jest.config.json`.

**CI** (`.circleci/config.yml`) : node:10, mongo:4.2, redis:4, `npm_config_build_from_source=true yarn --ignore-engines`.

**Autres :**
- `.nvmrc` : `10`.
- `.yarnrc` : `npm_config_build_from_source=true`, qui impose une toolchain C/C++ et Python sur Ubuntu.
- Pas de champ `engines` dans `package.json`.

---

## 6. Logs, New Relic et ClamAV

### Logs (`lib/logger.js`)

- winston 2.4.4 : `winston.cli()` et `new winston.Logger`.
- Transport Console : `colorize=COLOR_LOGS`, horodatage `YYYY-MM-DD HH:mm:ss:SSS`, `prettyPrint`, `handleExceptions`, `stderrLevels:['error']`, niveau `LOG_MIN_LEVEL`.
- Transport `winston-aws-cloudwatch` 1.6 (aws-sdk v2) si `WINSTON_CLOUDWATCH_ENABLED` : création du groupe et du stream.
- **UI :** logs d'accès morgan dans `LOG_DIR/access-YYYYMMDD.log` (`file-stream-rotator`).
- **API :** pas de log d'accès.

### New Relic (`newrelic` 4.13)

- Chargé **uniquement dans les bundles API et UI**, via la bannière, si `NEW_RELIC_LICENSE_KEY` est définie.
- Le worker et la CLI ne sont pas instrumentés.
- Pas de fichier `newrelic.js` (`NEW_RELIC_NO_CONFIG_FILE=true`).

### ClamAV (`lib/services/files/clamscan.js`, `clamscan` 0.8.5)

- Utilise `clamdscan` (`preference:'clamdscan'`, `remove_infected:true`, `config_file`).
- **Comportement « fail-open » :** si `CLAMDSCAN_BINARY` est absent ou qu'une erreur de scan survient, le fichier est accepté avec un warning. Seul un fichier infecté provoque un rejet (« This file has not passed the virus scan… »).
- **Appelé dans :**
  - `uploadLogo.js:40` (logo d'organisation) ;
  - `importPersonas/persistPersonas.js:13` (CSV personas) ;
  - `uploadPeople.js` (code mort).

---

## 7. Obsolescence pour Node LTS 2026, MongoDB récent et Ubuntu LTS

### Build et outillage (bloquants)

| Élément | Version | Où | Problème |
|---|---|---|---|
| `node-sass` | 4.13.1 | `sass-loader` dans `lib/tools/getWebpackConfig.js:106-109` | Ne compile pas sur Node récent ; LibSass est abandonné. À remplacer par `sass` (Dart Sass). |
| webpack | 3.12 | `lib/tools/*`, `*/build.js` | Sur Node ≥ 17 (OpenSSL 3), le hash md4 donne `ERR_OSSL_EVP_UNSUPPORTED`. Contournement : `--openssl-legacy-provider`. |
| `hard-source-webpack-plugin` | 0.5 | `getWebpackConfig.js:160` | Incompatible avec webpack ≥ 5. |
| `UglifyJsPlugin`, `CommonsChunkPlugin` | intégrés à webpack 3 | `getWebpackConfig.js:222-245` | Supprimés dans webpack 4 et 5. |
| babel 6 | `babel-core` 6.26, `babel-preset-env` 1.x, `stage-0`, `transform-runtime` (core-js 2) | `.babelrc` | Fin de vie. Syntaxe `export x from` (proposal) utilisée dans `lib/services/files/index.js`, `querybuildercache/index.js`, `statements/index.js`. |
| `mocha-webpack` 0.7, mocha 2, chai 3, jest 19, eslint 3, nock 9 | dev | `package.json` | Obsolètes. |

### MongoDB et données

| Élément | Version | Où | Problème |
|---|---|---|---|
| `@learninglocker/persona-service` | 1.7.1, driver **`mongodb@^2.2.26`** | `lib/connections/personaService.js`, worker, API, migration `20171008104700` | Le driver 2.2 n'utilise pas OP_MSG : **incompatible avec MongoDB ≥ 5.1/6**. Bloquant pour « MongoDB latest » : il faut remplacer ou forker ce paquet. |
| `@learninglocker/xapi-statements` | 7.8 | imports profonds `dist/...` dans `statementForwardingRequestHandler.js:5-7`, `getStatementsRepo.js:1`, migration `20171121153300` | Dépend d'API internes ; dépendances anciennes. |
| `mongoose` | 5.8.1 (driver 3.3.5) | `lib/models/*`, partout | Officiellement MongoDB ≤ 4.2. Mongoose ≥ 7 supprime les callbacks (environ 16 appels détectés, par exemple `listenForRedisPublish.js:36`, `statementHandler.js:59,117`, `updateStatementCount.js:6`) ainsi que `.remove()` (`cli/src/migrateMongo/migrate.js:11`, `importPersona.js` sur des documents). Mongoose 8 supprime `count()` (`orgUsageTracker.js:24,38-40`, `initializeOrgStatsList.js:13,21`). `.stream()` est déjà supprimé (`migrateToOrgSettings.js`). `poolSize` devient `maxPoolSize`. |
| `mongodb` (dépendance directe) | ^2.1.4 | `updateQueryBuilderCache.js` (`ObjectID`), migration `20171127214900` | Obsolète. |
| `collection.stats()` | — | `orgUsageTracker.js:34` | Supprimé dans le driver 6 ; `collStats` déprécié côté serveur. Remplacer par `$collStats`. |
| Internes du driver dans les bulk ops | — | `updateQueryBuilderCache.js:58-68` | Fragile à chaque montée de version du driver. |
| `express-restify-mongoose` | 3.2 | `api/src/routes/HttpRoutes.js` | Lié à Mongoose ≤ 5. |

### Queues, cloud et réseau

| Élément | Version | Où | Problème |
|---|---|---|---|
| `bull` | 3.12 | `lib/services/queue/bull/index.js` | À passer en bull 4 (maintenance) ou BullMQ. **Le schéma de clés Redis change avec BullMQ : vider les queues avant migration.** |
| `ioredis` | 4.28 (+ 3.2 en transitif) | `lib/connections/redis.js` | À passer en ioredis 5. |
| `sqs-consumer` | 3.8 | `queue/sqs/index.js` | API `create` avec aws-sdk v2. Les versions récentes (v7+) utilisent AWS SDK v3 en ESM. |
| `aws-sdk` v2 | 2.591 | SQS, `winston-aws-cloudwatch`, persona-service, pkgcloud | Fin de support. Migrer vers AWS SDK v3. |
| `@google-cloud/pubsub` | 0.16.5 | `queue/pubsub/index.js` | Fabrique `pubSub()` et `topic.publisher()` supprimés. |
| `@google-cloud/storage` | 1.7 | `files/storage/google.js` | Import par défaut et API changés (`{ Storage }`). |
| `azure-sb` | 0.11 | `queue/serviceBus/index.js` | Paquet retiré ou déprécié. |
| `@azure/service-bus` | 1.1 | idem | L'API 7.x est différente ; bug `schedualMessage`. |
| `@azure/storage-blob` | 10.5 | `files/storage/azure.js` | API v10 (`Aborter`, `ServiceURL`…) remplacée en v12. |
| `pkgcloud` | 1.7 | `files/storage/pkgcloud.js`, `amazon.js`, `rackspace.js` | Abandonné. Le stockage S3 passe par lui : réécrire avec `@aws-sdk/client-s3`. |
| `axios` | 0.21.1 | `statementForwardingRequestHandler.js` | À passer en axios 1.x. Attention à `err.response.body`, qui n'existe pas en axios (il faut `data`). |
| `passport-google-oauth` | 2.0 | `api/src/auth/passport.js` | Ancien paquet ; vérifier le profil Google OAuth2. |
| `git-rev` | 0.2 | `HttpRoutes.js:4,79-82` (`/version`) | Nécessite le binaire `git` et le dossier `.git` à l'exécution. |

### Infrastructure applicative

| Élément | Version | Où | Problème |
|---|---|---|---|
| `nodemailer` | 2.7.2 | `lib/connections/nodemailer.js` | Obsolète. Les options de configuration (`host`, `port`, `secure`, `ignoreTLS`, `requireTLS`, `auth`) restent compatibles en 6.x et 7.x. |
| `winston` | 2.4.4 | `lib/logger.js` | En v3, `new winston.Logger` et `winston.cli()` disparaissent (remplacés par `createLogger` et les formats). |
| `winston-aws-cloudwatch` | 1.6 | `lib/logger.js` | Lié à winston 2 et aws-sdk v2. |
| `newrelic` | 4.13 | bannière API et UI | Ne prend pas en charge les Node récents. Passer en 12.x ou plus. Les variables `NEW_RELIC_*` sont inchangées. |
| `clamscan` | 0.8.5 | `lib/services/files/clamscan.js` | En v2, l'API devient `new NodeClam().init()` puis `isInfected`. |
| `highland` | 2.13 | 12 fichiers : `requeueStatements`, `batcher`, `statementHandler`, SQS, `importPersonas`, `api/src/utils/exports.js`, migrations… | Peu maintenu ; à remplacer progressivement par les streams natifs ou async iterators. |
| `commander` | 2.x | `cli/src/server.js` | En v7+, les options passent par `.opts()` et la validation par regex (`batchJobs`) disparaît. |
| `uuid` | 2.0.3 | `import uuid from 'uuid'` (`sqs/index.js`, `bulkInsert.js`…) | Les versions ≥ 7 n'exposent que des exports nommés. |
| `boolean` | 0.1 | nombreux | La v3 utilise un export nommé. |
| `dotenv` | 2.0 | bannière, `build.js` | Ancien mais compatible ; garder la même sémantique (pas d'écrasement des variables déjà définies). |
| `multer` | 1.4.2 | inutilisé | Vulnérabilités ; à supprimer. |
| `multiparty` | 4 | `api/src/controllers/utils/getFileFromRequest.js` | Obsolète. |
| `helmet` | 2 | `ui/src/server.js` | Obsolète. |
| `jsonwebtoken` | 8 | API | Passer en v9. |
| `moment` | 2.24 | partout | Projet en mode maintenance. |
| `source-map-support` | 0.4 | bannière | Obsolète. |
| `file-stream-rotator` | 0.0.6 | UI | Obsolète. |
| `popsicle` | 3 | UI client | Obsolète. |
| `tincanjs` | — | CLI `bulkInsert` | Obsolète. |
| `restify`, `redis` 2.8, `marked`, `Base64` | — | aucun import | Dépendances mortes, à supprimer. |

### API Node dépréciées

| API | Où | Remplacement |
|---|---|---|
| `new Buffer()` | `lib/helpers/statementForwarding.js:15`, `lib/helpers/cursor.js` | `Buffer.from` |
| `fs.exists` | `lib/connections/multer.js:13` | `fs.existsSync` ou `fs.promises.access` |

### Ubuntu Server LTS

- Les modules natifs sont compilés depuis les sources (`.yarnrc`) : prévoir `build-essential` et `python3`.
- Exécution depuis la racine du dépôt (cwd) : requise pour `.env`, `lib/templates/emails`, `storage/tmp` et le `git` de `/version`.
- Le scheduler se cale sur **l'heure locale** du serveur (3 h) : le fuseau Ubuntu est UTC par défaut.
- `clamdscan` se trouve dans `/usr/bin/clamdscan` et sa configuration dans `/etc/clamav/clamd.conf` (paquet `clamav-daemon`).

---

## 8. À préserver pour la compatibilité des données et de la configuration

1. **Noms exacts des queues**, y compris la faute de frappe `STATEMENT_FORWARDING_REQEUST_QUEUE`, et le schéma `${QUEUE_NAMESPACE}_…`. Cela vaut pour les queues SQS, Service Bus et Pub/Sub existantes. Pour Pub/Sub, les subscriptions suivent `${SUBSCRIPTION_NAME}_…`. Bull utilise les clés `bull:<NS>_<Q>:*`.
2. **Le protocole Redis de l'xapi-service :** `{REDIS_PREFIX}:statement.new` (liste) et `{REDIS_PREFIX}:statement.notify` (canal), payload `{"statementId": "<uuid>"}`.
3. **Les clés de verrou et de cache Redis** (`cachePrefix`) : `EXPIRATION_SCHEDULER:RUNNING`, `ORG_USAGE_SCHEDULER:RUNNING`, `BATCH_STATEMENT_DELETION_SCHEDULER:RUNNING`, `*-AGGREGATION-*`.
4. **Les champs de suivi dans `statements`** : `completedQueues`, `processingQueues` (qui contiennent les noms logiques, par exemple `STATEMENT_PERSON_QUEUE`), `*ForwardingQueue`, `failedForwardingLog`.
5. **La collection `migrations`** : mêmes clés, même ordre.
6. **Les chemins de stockage** (`FS_LOCAL_ENDPOINT/FS_SUBFOLDER/...`, `downloads/`, `logos/`, `personasCsvs/`, `statements/`) et les champs `repo` enregistrés dans les documents.
7. **`APP_SECRET`** (JWT) et l'ensemble des variables du tableau 5.1, avec la même sémantique de valeurs par défaut : `boolean()` sur les chaînes, `defaultTo(Number(x))` qui retombe sur la valeur par défaut si NaN.
