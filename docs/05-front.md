# 05. Front React (`ui/`) : spécification fonctionnelle pour la réécriture Angular

> [Index de la documentation](README.md) · État du code : commit `5fec948a` (novembre 2021).

Les chemins partent de la racine du dépôt.

---

## 0. À retenir

1. **Le « SSR » n'en est pas un.** Le serveur UI ne fait jamais `renderToString` de l'application. Il renvoie une coquille HTML (`ui/src/components/Html/index.js`) avec `window.__data` (l'état Redux initial) et les scripts. Le rendu est 100 % client. Une SPA Angular servie en statique suffit, à deux exceptions près (cf. 1.2) :
   - le proxy `/api` ;
   - la route `/dashboards/:id[/:shareableId]`, qui a besoin d'un traitement serveur.
2. **Le backend importe du code du front.**
   - `lib/services/statements/utils/checkDashboardAuth.js` importe `ui/utils/visualisations/pipelinesFromQueries`. Il recalcule les pipelines d'agrégation pour autoriser les dashboards partagés (embed).
   - `api/src/auth/passport.js` et `cli/src/seed/index.js` importent `ui/utils/auth` (nommage des cookies).
   - `lib/routes/auth.js` importe `ui/redux/modules/auth`.
   - **Le dossier `ui/` ne peut donc pas être supprimé tel quel.** Ce code doit être déplacé dans `lib/` ou dupliqué à l'identique.
3. **Le plus gros risque de régression est la construction des pipelines MongoDB d'agrégation.** Elle se fait côté client (`ui/src/utils/visualisations/**`). Le pipeline envoyé par un dashboard embarqué doit être **strictement égal** (égalité Immutable) à celui que le serveur recalcule. Sinon : `UnauthorisedQueryError`.
4. **La base contient beaucoup de JSON stocké en chaînes**, sérialisé et désérialisé par le front (cf. 6.1). Le format doit rester identique.
5. **La sauvegarde est automatique.** Chaque modification déclenche un `PATCH` du document complet après 1 s d'inactivité. Il n'y a pas de bouton « Enregistrer », hors cas particuliers.

---

## 1. Architecture

### 1.1 Stack (versions dans `package.json`, unique à la racine)

| Domaine | Bibliothèques |
|---|---|
| UI | React ^16.8, react-redux 5, recompose 0.26 (HOC partout), react-toolbox 2.0.0-beta.13 (Material : Card, Tabs, Checkbox, Switch, Dropdown, DatePicker, Avatar, Tooltip, List, Button), Bootstrap 3.3.7 en CSS statique, ionicons 2 (icônes `ion-*`), glyphicons, animate.css |
| Store | redux 3.6, redux-saga 0.14, redux-thunk, redux-actions, reselect 2, redux-recycle, reduce-reducers, Immutable 3.8, normalizr **2.x** (`Schema`, `arrayOf`) |
| Routage | router5 4.5, redux-router5 4.2, router5.helpers |
| Graphiques | recharts ^1.0.1, react-virtualized 9 (AutoSizer, List, InfiniteLoader, MultiGrid), react-grid-layout 0.16.6, react-dimensions |
| Divers | popsicle 3 (HTTP), popsicle-basic-auth, js-cookie, jwt-decode, jsonwebtoken (exécuté dans le navigateur, cf. 6.6), moment + moment-timezone, numeral, lodash, uuid, react-portal 3 (modales), react-debounce-input (377 ms partout), react-color, react-textarea-autosize, velocity-react, react-scroll, react-helmet, styled-components 4.4 |
| Build | webpack 3, babel 6 (stage-0, décorateurs legacy), css-loader en CSS Modules + isomorphic-style-loader, sass-loader, postcss (`postcss.config.js` : custom properties, nesting, autoprefixer…), file-loader, url-loader, hard-source-webpack-plugin |
| Tests | jest 19, enzyme 3, jest-styled-components, redux-mock-store, axios-mock-adapter |

### 1.2 Serveur UI : `ui/src/server.js`

- **Express :**
  - `helmet({ frameguard: ENABLE_FRAMEGUARD })` (actif par défaut) ;
  - `compression`, `cookie-parser` ;
  - logs morgan dans `LOG_DIR/access-YYYYMMDD.log`, rotation journalière.
- **Statiques :** `ui/dist/public`. Le type MIME `font/woff2` est forcé pour `fonts/*.woff2`.
- **Proxy :** `app.use('/api', …)` via `http-proxy` vers `http://API_HOST:API_PORT`. En erreur, il renvoie un 500 JSON `{error:'proxy_error', reason}`.
- **Routes :**
  - `/dashboards/:dashboardId/:shareableId` et `/dashboards/:dashboardId` → `ui/src/controllers/renderDashboard.js` ;
  - `*` → `ui/src/controllers/renderApp.js`.
- **Port :** `UI_PORT || PORT`. Hôte : `UI_HOST`, `127.0.0.1` par défaut.

**`renderApp.js`**
- Renvoie la coquille HTML avec `state.app = { RESTRICT_CREATE_ORGANISATION, ENABLE_STATEMENT_DELETION }` (variables d'environnement, `true` par défaut).
- Ajoute les en-têtes `X-XSS-Protection` et `X-Content-Type-Options: nosniff`.
- La coquille définit aussi `window.rootUrl` (non utilisé).

**`renderDashboard.js`** (logique serveur à reproduire, en BFF ou côté API)
1. Lit **directement MongoDB** : `Dashboard.findById` (`lib/models/dashboard`).
2. Choisit le partage `shareable` (`_id === shareableId`, sinon `shareable[0]`). Sans partage : 404 « This dashboard has not been shared ».
3. Recopie sur l'objet dashboard les champs `filter`, `title`, `visibility` et `validDomains` du partage.
4. Crée un JWT dashboard (`createDashboardJWT`, `api/src/auth/jwt.js`) :
   - `tokenType:'dashboard'`, `tokenId:dashboardId`, `shareableId` ;
   - scopes `dashboard/shareable/view` ;
   - `extensions:{visualisationIds, orgTimezone}`.
5. Décode ce JWT dans un store Redux serveur (`decodeLoginTokenAction` puis `setActiveTokenAction('dashboard', id)`) et sérialise ce store dans `window.__data`. **Le token est transmis par l'état initial, pas par cookie.**
6. Applique `visibility` :
   - `VALID_DOMAINS` : le hostname du `Referer` doit matcher `validDomains` via **`micromatch.isMatch`**, c'est-à-dire en **glob**, alors que l'UI parle de « regex pattern ». Le site lui-même (`SITE_URL`) est toujours autorisé. Sinon 404. En succès, en-tête `X-Frame-Options: ALLOW-FROM <origin>` ;
   - `ANYWHERE` : `X-Frame-Options` retiré ;
   - `NOWHERE` (défaut) : 403.

**Déploiement en production** (`nginx.conf.example`)
- Nginx sert `ui/dist/public` en statique ;
- `/api/*` → API (préfixe retiré) ;
- `/data/xAPI*` → service xAPI ;
- le reste → serveur UI node.

PM2 (`pm2/all.json`) : processus `UIServer` = `ui/dist/server`.

### 1.3 Client : `ui/src/client.js`

`babel-polyfill`, puis création du store avec `window.__data`, puis `router.usePlugin(browserPlugin()).setDependency('store', store).start()`, puis `llClient.setStore(store)`, puis rendu de `<Root>` dans `#content`.
- Le contexte React expose `router` et `insertCss` (isomorphic-style-loader).
- `ui/src/components/Root` → `ui/src/containers/App/index.js`.

`App` aiguille selon le premier segment de route, avec chargement paresseux (`System.import`, via `ui/src/utils/createAsyncComponent.js`). Il monte aussi en permanence :
- `<Toasts/>` ;
- `<SaveBarErrors/>` ;
- `Helmet` : titre « Learning Locker %s », métadonnées OpenGraph (`ui/src/config.js`).

### 1.4 Build

- `ui/buildClient.js` : entrée `client.js` → `ui/dist/public`. Copie `ui/src/static` vers `dist/public/static`. Génère `assets.json`, chunk `vendor` via CommonsChunkPlugin, Uglify en release.
- `ui/buildServer.js` : entrée `server.js` → `ui/dist/server`, avec `nodeExternals` et une bannière dotenv/newrelic/source-map-support.
- Configuration commune : `lib/tools/getWebpackConfig.js`.
  - Alias `api`, `ui`, `worker`, `cli` et `lib` vers les dossiers source.
  - En développement, les assets sont servis sur le port **3131** (`//UI_HOST:3131/`).
  - DefinePlugin : `__CLIENT__`, `__SERVER__`, `__DEVELOPMENT__`, `__DEVTOOLS__`, `process.env.COOKIE_DOMAIN`, `process.env.BROWSER`. Bizarrerie : le build serveur définit lui aussi `__CLIENT__: true`.
- Scripts npm : `build-ui-server`, `build-ui-client`, `dev-ui-*`, `start-ui-server`, `test-ui` (`jest --config ui/jest.config.json --env node`).

**Variables d'environnement lues par le front et son serveur :** `UI_HOST`, `UI_PORT`/`PORT`, `API_HOST`, `API_PORT`, `ENABLE_FRAMEGUARD`, `COOKIE_DOMAIN` (le motif `HOSTNAME` y est remplacé par `location.hostname`), `RESTRICT_CREATE_ORGANISATION`, `ENABLE_STATEMENT_DELETION`, `SITE_URL`, `LOG_DIR`, `ENABLE_REACT_DEVTOOLS`.

### 1.5 Store Redux : `ui/src/redux`

**Création** (`create.js`). Ordre des middlewares :
1. thunk ;
2. `userMiddleware` : retire `password` et `passwordConfirmation` des users reçus ;
3. `clientMiddleware(llClient)` : **injecte `llClient` dans chaque action** ;
4. saga ;
5. `router5Middleware`.

`immutableMiddleware` existe mais n'est pas branché.

**Réducteurs** (`reducer.js`). Tous sont réinitialisés par `redux-recycle` sur `LOGOUT`, et la plupart aussi sur `ORG_LOGOUT`.

| Clé | Module | Contenu |
|---|---|---|
| `auth` | `modules/auth` | `tokens.user`, `tokens.organisation[orgId]`, `tokens.dashboard[id]` (JWT décodés, plus `token` brut), `activeTokenType`, `activeTokenId`, états des requêtes |
| `models` | `modules/models` | `[schema][id] = { remoteCache, localCache:{unsaved,pending}, requestState, cachedAt, deleteState, … }`, plus `saveQueue` |
| `pagination` | `modules/pagination` | `[schema][filterImmutable][sortImmutable] = { edges:OrderedSet<{id,cursor,cachedAt}>, pageInfo, [cursor]:{requestState,cachedAt} }`, plus `totalCount`, `countState`, `countCachedAt` |
| `aggregation` | `modules/aggregation` | `[pipelineImmutable] = { requestState, result:OrderedMap<_id,row>, startedAt, completedAt }` |
| `metadata` | `modules/metadata` | état d'UI par `[schema][id]` : `isExpanded`, `isNew`, `activePage`, `isSharing`, `mergeTargetId`, `personaViewActiveTab`, `isReassignmentVisible`, `reassignmentTargetId`… (`dashboardSharing[shareId].isExpanded` sert au filtre de prévisualisation) |
| `search` | `modules/search` | chaîne de recherche par schéma |
| `statements` | `modules/statements` | requête (`query`) et `timezone` de l'explorateur Source |
| `queries` | `modules/queries` | état d'expansion des sections du query builder par `componentPath` |
| `alerts`, `toasts` | | notifications |
| `exports`, `logo`, `mergePersona`, `uploadPersonas`, `requestAppAccess`, `userOrganisations`, `userOrganisationSettings`, `clientIds` | | états des requêtes |
| `app` | `modules/app` | drapeaux injectés par le serveur, plus `/api/app/<key>` (`googleAuth`, `version`) |
| `router` | `router5Reducer` | route courante |

**Schémas normalizr** (`ui/src/utils/schemas.js`). La classe `LLSchema` porte `preSave`, `reviver` et `validate`. Schémas :
`user, lrs, organisation, statement, visualisation, statementForwarding, stream, streamOutcome, persona, query, personaIdentifier, personaAttribute, scoredPersonas, importcsv, client, dashboard, export, download, querybuildercache, querybuildercachevalue, aggregation, role, globalError, personasImport, siteSettings`.

Les `preSave` et `reviver` encodent les chaînes JSON (cf. 6.1).

**Pattern `createAsyncDuck`** (`ui/src/utils/createAsyncDuck.js`)
- Actions `START`, `SUCCESS`, `FAILURE`, `COMPLETE`.
- `start` renvoie une Promise (via thunk) et n'est pas émis si `checkShouldFire` est faux. Cela sert de dé-duplication des requêtes.
- En échec : une `alert` rouge, et un `logout` si l'erreur est `Unauthorised` ou un `HttpError` 401.
- `COMPLETE` arrive 2 s après le succès ou l'échec (état « coche verte / rouge »).

**Cycle de vie des modèles** (`ui/src/redux/modules/models/*`)
- `fetchModel` : `GET /v2/<schema>/<id>`. Cache de 3 min. Ne refait pas la requête si le modèle a déjà un `_id`.
- `addModel` : `POST /v2/<schema>` avec `preSave(props)`. Ensuite `clearModelsCache(schema)`, puis métadonnées `isExpanded` et `isNew` à `true`. L'erreur Mongo 11000 sur `personaIdentifier` produit un message dédié.
- `updateModel({schema,id,path,value})` : écrit dans `localCache.unsaved`, puis `validate`. **La saga `autoSaveModel` empile la sauvegarde, puis exécute `saveModel` sur toute la file après 1 s sans nouvel `UPDATE_MODEL`.**
- `saveModel` : construit `remoteCache.merge(local)`, applique `preSave`, puis **`PATCH /v2/<schema>/<id>` avec le document COMPLET**. Avant l'envoi, `unsaved` passe en `pending`. Une réponse `ValidationError` est transformée en `errors.messages[field] = [...]` ; une `CastError` donne « Could not accept this value ».
- `deleteModel` : `DELETE /v2/<schema>/<id>`, puis vidage du cache de pagination.
- `pollWhile({schema,id,doWhile})` : refait `fetchModel(force)` toutes les **8 s** tant que `doWhile(model)` est vrai. Sert aux téléchargements d'export et aux imports de personas en cours.
- `modelsWorker` : refait `fetchModels` toutes les 3 s (legacy, `importcsv`).
- **Effet de bord :** un `updateModel` sur `organisation.timezone` vide les caches `dashboard`, `user`, `statementForward` (sic) et `visualisation`.
- **Sélecteur `modelsSchemaIdSelector`** : `remoteCache.merge(pending.merge(unsaved))`, en mode `deep` ou non.

**Sagas racine** (`ui/src/redux/modules/sagas.js`) : `auth`, `dashboard` (création depuis modèle, copie), `pagination`, `models`, `aggregation`, `visualise`, `people` (fusion), `exports`, `logo`, `toasts`, `app`, `alerts`, `persona` (import), `requestAppAccess`, `visualisation` (copie), `userOrganisations`, `userOrganisationSettings`.

### 1.6 Routage router5

Défini dans **`lib/routes/index.js`** : il est partagé avec le serveur UI. Gardes dans `lib/routes/auth.js`. Options : `defaultRoute:'login'`, `trailingSlash:true`.

Un middleware redirige `organisation` → `organisation.data` → `organisation.data.dashboards`.

| Garde | Comportement |
|---|---|
| `requireLogin` | lit le cookie `access_token_user_*`. Absent : redirection vers `login`. Présent : token actif = `user` |
| `requireNoLogin` | si déjà connecté : redirection vers `home` |
| `requireSiteAdmin` | scope `site_admin` requis, sinon redirection vers `home` |
| `requireOrgLogin` | lit le cookie `access_token_organisation_<orgId>`. Absent : **connexion automatique à l'organisation** (`POST /auth/jwt/organisation`). Échec : redirection vers `home`. Token actif = `organisation`/`orgId` |
| `requireModelViewScope(model)` | `canViewModel(model, scopes)` : il faut `org/all/<model>/manage`, `site_admin` ou `all` (`lib/services/auth/canViewModel.js`). Sinon redirection vers `organisation.data.dashboards` |

Pour la navigation, `ui/src/containers/Link` construit un `<a href>` avec `router.buildUrl` puis appelle `navigateTo`. La classe active est calculée avec `includesSegment`.

---

## 2. Inventaire des routes et écrans

Le layout « organisation » (`ui/src/containers/OrganisationHome`) comprend :
- `TopNav` : logo blanc, `SaveBar` (barre de progression des sauvegardes), bouton Logout, bouton « Switch organisation » qui déclenche `orgLogout` puis renvoie vers home ;
- `SideNav` : logo et nom de l'organisation, menus repliables Data / People / Settings ;
- `AuthContainer` : charge le user connecté via `connection/user?filter={_id}`.

| Nom router5 | URL | Garde ou permission | Composant | Fonction |
|---|---|---|---|---|
| `login` | `/login` | `requireNoLogin` | `ui/src/pages/LoginPage` | Email et mot de passe ; bouton Google si `GET /api/app/googleAuth` renvoie `enabled` ; lien « Reset password » ; erreurs dans une alerte |
| `forgot` | `/forgot` | — | `ui/src/pages/ForgotPasswordPage` | Saisie de l'email puis `POST /auth/resetpassword/request` |
| `reset` | `/reset?email&token` | — | `ui/src/pages/ResetPasswordPage` | Nouveau mot de passe (non vide) puis `POST /auth/resetpassword/reset` ; affiche l'erreur `errors.password.message` ; lien vers login |
| `home` | `/home` | `requireLogin` | `ui/src/pages/HomePage` | **Choix d'organisation** (détail ci-dessous) |
| `admin` | `/admin` | `requireSiteAdmin` | `ui/src/containers/Admin` | Layout avec `AdminSideNav` (Users, Organisations). Aucune page à la racine |
| `admin.users` | `/admin/users` | idem | `ui/src/pages/SiteUsersPage` | Tous les utilisateurs (tri email). Recherche nom/email. Fiche : `UserForm` (nom, email, vérifié, mot de passe), cases scopes site (`site_admin`, `site_can_create_org`), liste des organisations (10 maximum, plus « +N ») avec liens. Pas de bouton d'ajout |
| `admin.users.id` | `/admin/users/:userId` | idem | idem | Même liste, utilisateur ciblé déplié |
| `admin.organisations` | `/admin/organisations` | idem | `ui/src/pages/SiteOrgsPage` | Toutes les organisations (tri nom). Ajout, `OrgMemberButton` (rejoindre / quitter), suppression. Fiche `SiteOrgItem` = `SubOrgForm` plus la liste des membres |
| `admin.organisations.id` | `/admin/organisations/:organisationId` | idem | idem | Organisation ciblée dépliée |
| `organisation` | `/organisation/:organisationId` | `requireOrgLogin` | — | Redirection vers `.data.dashboards` |
| `organisation.data` | `…/data` | — | — | Redirection vers `.dashboards` |
| `organisation.data.dashboards` | `…/data/dashboards` | org | `ui/src/containers/Dashboards` | Grille de cartes dashboards (12 par page, « Load more »). Bouton « Add Dashboard » qui ouvre `DashboardTemplates`. Menu de carte : renommer, dupliquer, public/privé, supprimer. Icône selon `type`, cadenas si privé, propriétaire |
| `organisation.data.dashboards.add` | `…/data/dashboards/add` | org | `Dashboards` | Route existante, rendu identique à la liste |
| `organisation.data.dashboards.id` | `…/data/dashboards/:dashboardId` | org | `ui/src/containers/Dashboard` | **Édition du dashboard** (détail ci-dessous) |
| `organisation.data.visualise` | `…/data/visualise` | org | `ui/src/containers/Visualise` | Liste des visualisations (tri `createdAt` desc). Recherche sur `description`. « Add new » crée `{owner, isExpanded:true, timezone:null}`. Boutons : public/privé, copier, supprimer. L'item déplié affiche `VisualiseForm` |
| `organisation.data.visualise.visualisation` | `…/data/visualise/:visualisationId` | org | idem | Visualisation ciblée dépliée |
| `organisation.data.source` | `…/data/source` | org | `ui/src/pages/DataSourcePage` | **Explorateur de statements** (détail ci-dessous) |
| `organisation.data.statementForwarding` | `…/data/statementforwarding` | org | `ui/src/pages/DataStatementForwardingPage` | CRUD des statement forwarders (cf. 2.6) |
| `organisation.people` | `…/people` | org | NotFound | Pas de page. Section visible seulement si `canViewModel('persona')` ; la route elle-même n'est pas gardée |
| `organisation.people.manage` | `…/people/manage` | org | `ui/src/pages/PeopleManagePage` | Personas (cf. 2.7) |
| `organisation.people.manage.persona` | `…/people/manage/:personaId` | org | idem | Persona ciblée dépliée |
| `organisation.people.imports` | `…/people/imports` | org | `ui/src/pages/PeopleImportPage` | Imports CSV de personas (cf. 2.8) |
| `organisation.people.reconcile` | `…/people/reconcile` | org | NotFound | Route orpheline |
| `organisation.settings` | `…/settings` | org | NotFound | Menu visible si l'utilisateur peut voir au moins un modèle de réglages |
| `organisation.settings.stores` | `…/settings/stores` | `org/all/store/manage` | `ui/src/pages/SettingsStoresPage` | LRS : titre, description, nombre de statements dans le libellé (`statementCount`). L'ajout invalide le cache `client` (le serveur crée un client) |
| `organisation.settings.users` | `…/settings/users` | `org/all/user/manage` | `ui/src/pages/SettingsUsersPage` | Utilisateurs de l'organisation (cf. 2.9) |
| `organisation.settings.suborgs` | `…/settings/organisations` | `org/all/organisation/manage` | `ui/src/pages/SettingsOrganisationsPage` | Sous-organisations (`parent = orgId`). Ajout seulement si `canCreateOrganisations`. Formulaire `SubOrgForm` (cf. 2.10) |
| `organisation.settings.clients` | `…/settings/clients` | `org/all/client/manage` | `ui/src/pages/SettingsClientsPage` | Clients API (cf. 2.11). Affiche l'endpoint xAPI `origin + /data/xAPI` |
| `organisation.settings.roles` | `…/settings/roles` | `org/all/role/manage` | `ui/src/pages/SettingsRolesPage` | Rôles : titre, description, matrice de scopes (cf. 6.9) |
| `organisation.settings.apps` | `…/settings/apps` | org | `ui/src/pages/SettingsAppsPage` | Cartes de liens externes (Sparks, Stream, Moodle, Semantic Analysis, BI Connector, Survey Monkey, getAbstract, Degreed, Cornerstone, Google Forms, Yammer…) |
| `organisation.apps` | `…/apps` | org | idem | Même page |
| `organisation.apps.salesDemo` | `…/apps/salesDemo` | org | `ui/src/pages/SettingsAppsPage/subpages/SalesDemoAppPage.js` | Formulaire de demande d'accès (consentement RGPD) : `POST /api/requestAppAccess {appConfig:{privacyPolicy, appName:'Sales Demo'}}` |
| `embedded-dashboard` | `/dashboards/:dashboardId` | token dashboard (rendu serveur) | `ui/src/containers/EmbeddableDashboard` | Grille en lecture seule (`editable=false`), sans layout ni menu de widget |
| `embedded-dashboard.shareable` | `/dashboards/:dashboardId/:shareableId/*splat` | idem | idem | `splat` = titre slugifié, ignoré |
| `embedded-dashboard.shareable.filter` | `…?filter=…` | idem | idem | Filtre d'URL : JSON en clair (mode `ANY`) ou JWT (mode `JWT_SECURED`), cf. 6.6 |

### 2.1 Home : choix d'organisation (`ui/src/pages/HomePage/index.js`)

- Au montage, **appelle `orgLogout()`**. Cela supprime les cookies et tokens d'organisation et navigue vers home.
- Organisations listées : `connection/organisation?filter={_id:{$in:user.organisations}, name:{$regex}}`, tri `{name:1,_id:-1}`.
  - Liste virtualisée (react-virtualized InfiniteLoader, 56 px par ligne, 6 lignes visibles), avec le compte via `/v2/organisation/count`.
  - Champ de recherche affiché si plus de 5 organisations ou si une recherche est en cours.
- Organisation expirée (`expiration` passée) : libellé « Expired » ; le clic est bloqué sauf pour un admin site.
- Le clic lance `orgLoginStart({organisation})`, puis navigue vers `organisation`.
- Admin site : liens « View all users » et « View all organisations », plus `OrgMemberButton` sur chaque ligne. Rejoindre / quitter = `PATCH` du user connecté avec `organisations`.
- **Écran Register** (`ui/src/pages/HomePage/Register`) : affiché à la place de la liste si `siteSettings(111111111111111111111111).dontShowRegistration !== true` et si `sessionStorage.proceedOnce` n'est pas positionné.
  - « Not now » positionne `sessionStorage.proceedOnce` et émet l'événement DOM `setProceedOnce`.
  - « Enter a Registration Code » : **le code est comparé côté client à la constante `LLOSREG2021`** (`lib/constants/siteSettings.js`). S'il correspond : `PATCH siteSettings.dontShowRegistration=true`.
- Fond plein écran avec la version (`GET /api/app/version`, dans `ui/src/components/FullPageBackground`).

### 2.2 Liste des dashboards et modèles de dashboard

`ui/src/containers/DashboardTemplates` propose trois cartes, qui déclenchent les sagas de `ui/src/redux/modules/dashboard/*` :

| Modèle | Type | Création |
|---|---|---|
| **Blank** | `blankDashboard` | `POST dashboard {owner, title:'Blank Dashboard', type, isExpanded}`, puis navigation vers ce dashboard |
| **Getting Started** | `gettingStarted` | 7 visualisations (cf. 6.7), puis un dashboard de 6 widgets : (0,0,6,8) Last7Days ; (6,0,6,8) ActivityOverTime ; (0,8,6,9) Verbs ; (6,8,6,9) Activities ; (0,17,6,9) People ; (6,17,6,9) Weekdays. La 7ᵉ (LearningExperienceType) est créée mais pas placée |
| **Stream Starter** | `streamStarter` | 8 visualisations, puis 7 widgets (layout dans `streamStarter.js`) |

**Dupliquer** (`copyDashboard.js`)
- Copie chaque visualisation unique du dashboard en retirant `_id`, `updatedAt`, `createdAt`, `__v` et `owner`, puis met `owner` = user courant.
- Remappe ensuite les ids de visualisation des widgets (sans leur `_id`) et des partages (sans `_id`).
- Crée le dashboard et navigue vers lui.

### 2.3 Édition d'un dashboard (`ui/src/containers/Dashboard`)

**En-tête**
- Titre éditable (auto-sauvegardé) et bouton retour.
- « Add widget » ouvre la modale `WidgetVisualiseCreator` : autocomplétion des visualisations (recherche `description` en regex insensible à la casse) et titre.
  - À la sélection : `saveModel` immédiat avec le widget `{visualisation, w:5, h:8, y:last.y+last.h}`.
- Bouton « Share » : bascule la métadonnée `isSharing`.

**Grille** (`ui/src/containers/DashboardGrid`)
- react-grid-layout : 12 colonnes, `rowHeight` 50, `minW` 3, `minH` 4, poignée de déplacement `.react-drag-handle` (titre du widget).
- `onLayoutChange` fusionne `x, y, w, h` par `widget._id`, puis `updateModel('widgets')` et émet un événement `resize`.
- Widgets triés par `y`.

**Widget** (`ui/src/containers/Widget`) : titre = `widget.title || viz.description || titre par défaut`. Menu :
- « Enable/Disable table view » : bascule `visualisation.sourceView` (sauf compteurs) ;
- « Enable/Disable donut » (PIE seulement) ;
- « Go to visualisation » ;
- « Edit Widget » : modale `WidgetVisualisePicker` (titre et visualisation) ;
- « Delete » : confirmation, puis filtrage des widgets.

Le corps du widget est `VisualisationViewer`.

**Partage** (`ui/src/containers/DashboardSharing`) : liste des `shareable`.
- « New shareable link » ajoute `{title:'Shareable', createdAt, timezone:null}`.
- Champs de chaque partage :
  - Title ;
  - lien partageable en lecture seule, avec bouton « Copy link » (`execCommand('copy')`) et ouverture dans un nouvel onglet ;
  - Visibility : `NOWHERE`, `ANYWHERE` ou `VALID_DOMAINS` (+ `validDomains`) ;
  - URL filter mode : `OFF`, `ANY` (Plaintext) ou `JWT_SECURED`. En JWT : `filterJwtSecret` (HS256) et `filterRequired` Oui/Non ;
  - Timezone du filtre de base (modifier le fuseau réécrit les `$dte` du filtre) ;
  - **Base filter** : QueryBuilder.
- Quand un partage est déplié (`metadata.dashboardSharing[shareId].isExpanded`), **tout le dashboard est prévisualisé avec ce filtre**.
- Les erreurs serveur `shareable.N.filterJwtSecret` sont remontées sur le bon partage.

### 2.4 Visualisations

Écran : `ui/src/containers/Visualise`. Formulaire : `ui/src/containers/VisualiseForm`.

- **Nouvelle visualisation, sans `type`** : composant `NewVisualisation`.
  - Section **Custom** : 6 cartes (Bar, Correlation, Column, Line, Counter, Pie). Chaque carte affiche un texte d'aide, et le bouton ✓ fait `saveModel({type})`.
  - Section **Templates** : 13 cartes. Le clic fait `saveModel(buildModel(model))`.
- **Visualisation typée** : éditeur spécifique au type.
  - Colonne gauche : `DescriptionForm`, puis onglets **Axes / Series / Options**.
  - Colonne droite : `PreviewPeriodPicker`, puis aperçu de 400 px.
- Détail par type : section 3bis.

### 2.5 Source : explorateur de statements (`ui/src/pages/DataSourcePage`)

- Colonne gauche : **QueryBuilder** « Explore ». La requête vit dans le store `statements.query` ; elle n'est pas persistée.
- Colonne droite :
  - liste paginée des statements via `connection/statement?filter=<query>&sort={timestamp:-1,_id:1}`, 10 par page avec « Load more » ;
  - chaque ligne est une phrase « acteur verbe objet » avec l'heure relative (rafraîchie toutes les 5 s) ;
  - **cliquer sur un acteur, un verbe ou une activité ajoute un critère au query builder** (`setFilterAt` → `valueToCriteria` + `addTokenToQuery`). L'acteur utilise `person` s'il existe (`person._id`) ;
  - l'item déplié affiche le JSON complet (`StatementForm`).
- La requête est recalée sur le fuseau de l'organisation (`update$dteTimezone`) à chaque mise à jour.
- **Panneau Export** (icône de téléchargement, `ExportManager`). Onglets :
  - **Manage** : sélection ou création d'un export (`ModelAutoComplete` sur `export`, avec ajout, renommage et suppression inline).
    - Projection éditée en tableau clé → `$chemin`, avec autocomplétion des clés `querybuildercache`, ou en **mode raw JSON** (`rawMode`).
    - Aperçu : 1 statement avec la projection appliquée (MultiGrid).
    - « Download » : `GET /api/export?exportId&pipelines=[[{$match:query},{$sort:{timestamp:-1,_id:1}},{$project:projection}]]`, puis le message « Your download will be available in the Downloads tab ».
    - Projection par défaut : `_id`, `version`, `id`, `timestamp`, `stored`, `actor`, `verb`, `object`, `result`, `authority`, `context`, chacun depuis `$statement.*`.
  - **Downloads** : `connection/download`, tri `{time:-1}`. Chaque téléchargement est interrogé (`pollWhile`) tant que `!isReady`. Lien `href=model.url` (authentifié par cookie). Suppression possible. « pending or failed » après 1 jour.

### 2.6 Statement Forwarding (`ui/src/pages/DataStatementForwardingPage`)

- Liste recherchable sur `description`.
- Ajout : `{owner, isExpanded, timezone:null}`.
- Boutons : public/privé, supprimer.
- Formulaire `StatementForwardingForm.js` :
  - `active` (Switch), `description` ;
  - `fullDocument` (« Send full database record? »), `sendAttachments` ;
  - `configuration.protocol` (http/https), `configuration.url` ;
  - `configuration.authType` (`no auth` | `token` | `basic auth`), avec `secret`, ou `basicUsername` et `basicPassword` ;
  - `configuration.headers` : éditeur clé/valeur, **stocké en chaîne JSON**. En-têtes d'authentification calculés affichés en lecture seule (`lib/helpers/statementForwarding.getAuthHeaders` / `getHeaders`) ;
  - `configuration.maxRetries` (0–10) ;
  - `timezone` ;
  - `query` (QueryBuilder, stocké en chaîne JSON).
  - Si l'offset de fuseau change, la requête est réécrite automatiquement.
  - Erreurs serveur par champ (`configuration.url`…).

### 2.7 People › Manage (`ui/src/pages/PeopleManagePage`)

- Liste des personas (tri `_id` desc), recherche sur `name`.
- « Add person » : `POST persona {isExpanded, identifiers:[{key:'xapi_name', values:['New Persona']}]}`.
- Fiche `PersonaView` : `Name`, puis onglets :
  - **Identifiers** : `connection/personaidentifier?filter={persona:{$oid}}`, 100 maximum. Ajout d'un IFI de type `mbox` (Email), `mbox_sha1sum`, `openid` ou `account` (homePage et name), avec validation côté client (`@learninglocker/xapi-validation` : iri, mailto). `POST personaIdentifier {ifi:{key,value}, persona}`. Par identifiant : suppression, et **réaffectation** à une autre persona (`PATCH personaIdentifier.persona`, puis invalidation des deux listes).
  - **Attributes** : `connection/personaattribute?filter={personaId:{$oid}}`. CRUD `{key, value, personaId}`.
  - **Merge** : choix d'une persona source (autocomplétion), aperçu de ses identifiants et attributs, puis bouton « Merge Persona » : `POST /api/mergepersona?mergePersonaFromId=<source>&mergePersonaToId=<courante>`, puis invalidation des caches `persona`, `personaIdentifier` et `personaAttribute`.

### 2.8 People › Imports (`ui/src/pages/PeopleImportPage`)

- Liste des `personasImport`. Ajout : `{owner, isExpanded}`. La suppression est désactivée pendant `STAGE_PROCESSING`.
- Étapes (`importStage`, `lib/constants/personasImport.js`) :
  - `STAGE_UPLOAD` : choix d'un `.csv`, puis `POST /api/uploadpersonas` (multipart `id`, `file`). La réponse est un `personasImport` dont la `structure` est déduite.
  - `STAGE_CONFIGURE_FIELDS` : `ColumnHeaderEditor`. Pour chaque colonne :
    - `columnType` : `COLUMN_NAME`, `FIRST_NAME`, `LAST_NAME`, `MBOX`, `MBOXSHA1SUM`, `OPENID`, `ACCOUNT_KEY`, `ACCOUNT_VALUE`, `ATTRIBUTE_DATA` ou rien ;
    - `primary` (ordre) ;
    - `relatedColumn`, `useConstant`/`constant` (homePage de compte) ;
    - `attributeKey`.
    - La logique vient de `lib/services/importPersonas/personasImportHelpers` (`resetRelatedStructure`, `isColumnOrderable`, `getPrimaryMaxPlusOne`).
    - « Import Personas » : `POST /api/importpersonas {id}`.
  - `STAGE_PROCESSING` : interrogation toutes les 8 s.
  - `STAGE_IMPORTED` : date, nombre de personas fusionnées et créées, lignes en erreur avec lien `GET /api/organisation/:orgId/importpersonaserror/:id.csv` (authentifié par cookie). Bug JS de précédence : `STAGE_PROCESSING || STAGE_IMPORTED && …`.

### 2.9 Settings › Users (`ui/src/pages/SettingsUsersPage`)

- Liste recherchable sur nom et email. Avatar (`imageUrl`), icône Google si `googleId`.
- « Invite » : modale email, puis `POST user {email, isExpanded}`. Le serveur ajoute l'organisation.
- « Supprimer » **retire seulement l'utilisateur de l'organisation** : `DELETE /api/v2/users/:userId/organisations/:orgId`.
- Fiche `UserOrgForm` :
  - `UserForm` : nom ; email ; statut vérifié ; changement de mot de passe (seulement admin site ou soi-même), avec double saisie et validation selon les règles de l'organisation propriétaire (`lib/utils/validators/User.validatePasswordUtil`, `ownerOrganisationSettings`), puis `saveModel({password})` ;
  - **Organisation Roles** : cases des rôles de l'organisation. Visibles si `site_admin`, `all` ou `org/all/user/manage` ;
  - **Site Roles** (`site_can_create_org`) : si `RESTRICT_CREATE_ORGANISATION` et `site_admin` ;
  - **User Filter Timezone** : modifiable seulement par un admin site ;
  - **User Filter** : QueryBuilder.
  - Rôles, filtre et fuseau passent par `PATCH /api/v2/users/:userId/organisationSettings/:orgId` avec un corps `{roles}`, `{filter: "<json string>"}` ou `{timezone, filter}`, puis `fetchModel(user, force)`.

### 2.10 Organisation : `SubOrgForm` (`ui/src/containers/SubOrgForm/index.js`)

- **Champs :** nom, logo (upload `POST /api/uploadlogo?data=<orgId>` en multipart `logo` ; met à jour `logoPath`), `timezone`.
- **Auth settings** (`settings.*`) :
  - `PASSWORD_MIN_LENGTH`, `PASSWORD_REQUIRE_ALPHA`, `PASSWORD_REQUIRE_NUMBER` ;
  - `PASSWORD_USE_CUSTOM_REGEX`, avec `PASSWORD_CUSTOM_REGEX` et `PASSWORD_CUSTOM_MESSAGE` ;
  - `LOCKOUT_ENABLED`, avec `LOCKOUT_ATTEMPS` (sic) et `LOCKOUT_SECONDS` ;
  - `PASSWORD_HISTORY_CHECK`, avec `PASSWORD_HISTORY_TOTAL`.
- **Expiration :** DatePicker, en lecture seule si l'utilisateur n'est pas admin site.
- **Statistiques d'usage** (admin site) : `usageStats.OWN_COUNT`, `OWN_ESTIMATED_BYTES`, `TOTAL_*`, `HAS_CHILDREN`.
- `ui/src/containers/Organisation` et `OrgForm` ne sont utilisés par aucune route.

### 2.11 Clients API (`ui/src/pages/SettingsClientsPage/ClientForm.js`)

- `title` ; `isTrusted` (« Enabled? ») ; `api.basic_key` et `api.basic_secret` en lecture seule ; valeur `Basic base64(key:secret)` affichée.
- **Overall Scopes** (`API_SCOPES`) : `all`, `statements/delete`.
- **LRS** : `lrs_id` (dropdown des 100 premiers stores ; option « ~ No store ~ »).
- Si un LRS est choisi :
  - **scopes xAPI** (`getXapiScopes`) : `xapi/all`, `xapi/read`, `statements/read`, `statements/write`, `statements/read/mine`, `state`, `profile` ;
  - **Authority** (`AuthorityEditor`) : agent `{objectType:'Agent', name, mbox | account{homePage,name} | openid | mbox_sha1sum}`, avec des valeurs par défaut à chaque changement d'IFI ; **stockée en chaîne JSON**.

---

## 3bis. Types de visualisation et options

Les constantes sont dans `lib/constants/visualise.js`. Pour tous les types : `description`, `previewPeriod` (`TODAY`, `LAST_24_HOURS`, `LAST_7_DAYS`, `LAST_30_DAYS`, `LAST_2_MONTHS`, `LAST_6_MONTHS`, `LAST_1_YEAR`, `LAST_2_YEARS` ; `LAST_7_DAYS` par défaut côté serveur) et `timezone` (`null` = fuseau de l'organisation).

**« Series »** = `filters`, une liste de `{ $match, label?, color? }`.
- 5 séries au maximum (`filters.count() < 5`) pour Bar, Column, Line, Correlation et Pie.
- Avec une seule série, pas d'onglets. Avec plusieurs, un onglet par série ; libellé éditable et suppression possibles.
- `ColorPicker` (`react-color`) ; couleurs par défaut `VISUALISATION_COLORS = ['#F5AB36','#DB0A5B','#36D7B7','#9B59B6','#F77F3F','#1E8BC3','#ED4444']`.

### Types « custom »

| `type` | Libellé (carte) | Éditeur et rendu | Construction du pipeline | Onglet Axes (champs persistés) | Options |
|---|---|---|---|---|---|
| `LEADERBOARD` | **Bar** | `Visualisations/CustomBarChart` → `BarChartResults` (barres horizontales) ou `SourceResults` | `aggregateChart` | Axe X : `axesxLabel` ; `axesoperator` + `axesvalue` (CountEditor). Axe Y : `axesyLabel` ; `axesgroup` (GroupEditor) ; `axesgroup.contextActivityDefinitionType` si le groupe est un contextActivities | `stacked` (true), `sourceView`, `showStats` (true), `statsAtBottom` (true), `barChartGroupingLimit` (5/10/15/20, 10 par défaut ; remet `activePage` à 0) |
| `STATEMENTS` | **Column** | `CustomColumnChart` → `ColumnChartResults` / `SourceResults` | `aggregateChart` | X : `axesxLabel`, `axesgroup` (+ type de définition). Y : `axesyLabel`, operator + value | `stacked`, `sourceView`, `showStats`, `statsAtBottom` |
| `FREQUENCY` | **Line** | `CustomLineChart` → `LineChartResults` / `SourceResults` | `aggregateChart`, groupe **toujours `date`** faute de GroupEditor | Y : `axesyLabel`, operator (`LINE_OPERATOR_OPTS` seulement) + value. X : `axesxLabel` (placeholder « yyyy/mm/dd ») | `sourceView`, `showStats`, `statsAtBottom` |
| `XVSY` | **Correlation** | `CustomXvsYChart` → `XvsYChartResults` (nuage de points) / `SourceResults` | `aggregateXvsY` : **2 pipelines par série** | `axesgroup` (+ type de définition) ; pour x et y : `axes{x,y}Label`, `axes{x,y}Operator`, `axes{x,y}Value`, `axes{x,y}Query` (QueryEditor optionnel, sous la forme `{ $match:{…} }`) | `trendLines` (régression `lineType="fitting"`), `sourceView`, `showStats`, `statsAtBottom` |
| `COUNTER` | **Counter** | `CustomCounter` → `CounterResults` | `aggregateCounter` | « Count » : operator + value | `benchmarkingEnabled`, `contextLabel`. Une seule série, pas de vue tableau |
| `PIE` | **Pie** | `CustomPieChart` → `PieChartResults` / `SourceResults` | `aggregateChart` | « Group by » : `axesgroup`. « Count » : operator + value | `isDonut`, `sourceView`, `showStats`, `statsAtBottom` |

**Opérateurs** (`ui/src/utils/visualisations/localOptions.js`)

| Clé | Libellé | Disponibilité |
|---|---|---|
| `uniqueCount` | « Total unique number of » | tous les types |
| `count` | « Sum of » | tous les types |
| `average` | « Average of » | tous les types |
| `max` | « Max from » | tous les types |
| `min` | « Min from » | tous les types |
| `uniqueAverage` | « Average unique number of » | sauf Line et ActivityOverTime |
| `uniqueMax` | « Max unique number of » | sauf Line et ActivityOverTime |
| `uniqueMin` | « Min unique number of » | sauf Line et ActivityOverTime |

**Valeurs (`axes*value`)**
- Avec un opérateur `unique*` : `statements`, `people`, `activities`, `verb`, `type`, `scaled`, `raw`, `steps`, plus n'importe quelle clé `querybuildercache`.
- Avec les autres opérateurs : `scaled`, `raw`, `steps`, plus les clés `querybuildercache` filtrées sur `valueType:{$eq:'Number'}`.
- Format stocké : `{optionKey, searchString}`. Pour une clé du cache, `optionKey = searchString = chemin`.

**Groupes (`axesgroup`)** : `date`, `hour`, `weekday` (« Day »), `month`, `year`, `people`, `activities`, `verb`, `type`, `raw`, `response`, plus toute clé `querybuildercache` (dont `persona.import.<attr>` et `statement.context.contextActivities.{grouping|category|other|parent}`).
- Le `DefinitionTypeSelector` liste les `querybuildercachevalue` dont `path = <groupe>.definition.type`.

**Effet de bord à reproduire.** Au montage, `CountEditor` et `GroupEditor` **écrivent leurs valeurs par défaut dans le modèle** (`componentDidMount` → `changeAxes`) :
- opérateur `uniqueCount` ;
- valeur `statements` ;
- groupe **`hour`** pour GroupEditor.

Ouvrir l'éditeur d'une visualisation sans axes déclenche donc une sauvegarde.

### Templates

Le `buildModel` de chaque template est dans `ui/src/containers/Visualisations/Template*/buildModel.js`. L'éditeur d'un template est celui du type de base, sauf mention contraire.

| `type` | Base / rendu | Préréglages (`buildModel`) |
|---|---|---|
| `TEMPLATE_ACTIVITY_OVER_TIME` | Line | `uniqueCount` statements ; xLabel « Date », yLabel « Statements » ; `LAST_2_MONTHS` |
| `TEMPLATE_LAST_7_DAYS_STATEMENTS` | Counter | `uniqueCount` statements ; `LAST_7_DAYS` |
| `TEMPLATE_MOST_ACTIVE_PEOPLE` | Bar | group `people` ; `LAST_2_MONTHS` |
| `TEMPLATE_MOST_POPULAR_ACTIVITIES` | Bar | group `activities` ; `LAST_2_MONTHS` |
| `TEMPLATE_MOST_POPULAR_VERBS` | Bar | group `verb` ; `LAST_2_MONTHS` |
| `TEMPLATE_WEEKDAYS_ACTIVITY` | Column | group `weekday` ; `LAST_7_DAYS` |
| `TEMPLATE_LEARNING_EXPERIENCE_TYPE` | Bar ; **éditeur réduit** (description et période seulement) | group `statement.context.contextActivities.grouping` ; `LAST_7_DAYS` |
| `TEMPLATE_STREAM_INTERACTIONS_VS_ENGAGEMENT` | Correlation | group `people` ; `axesxQuery` (verbes completed, commented, voted-up, shared, attempted… ET platform ∈ {Stream, Curatr}) ; `axesyQuery` (loggedin, open, access) ; `trendLines` ; `LAST_7_DAYS` |
| `TEMPLATE_STREAM_COMMENT_COUNT` | Counter | filtre verbe `commented` + platform ; `benchmarkingEnabled:true` ; `LAST_7_DAYS` |
| `TEMPLATE_STREAM_LEARNER_INTERACTIONS_BY_DATE_AND_VERB` | Column | group `date` ; 5 séries libellées (Comments, Completions, Voted Up, Shared, Logins) ; `LAST_30_DAYS` |
| `TEMPLATE_STREAM_USER_ENGAGEMENT_LEADERBOARD` | Bar | group `people` ; 4 séries ; `LAST_7_DAYS` |
| `TEMPLATE_STREAM_PROPORTION_OF_SOCIAL_INTERACTIONS` | Pie | group `verb` ; `isDonut` ; filtre sur 3 verbes + platform ; `LAST_7_DAYS` |
| `TEMPLATE_STREAM_ACTIVITIES_WITH_MOST_COMMENTS` | Bar | group `activities` ; `sourceView:true` ; filtre `commented` + platform ; `LAST_7_DAYS` |

Les filtres des templates contiennent des `$comment` du type `'{"criterionLabel":"A","criteriaPath":["statement","verb"]}'` : c'est le format du query builder.

---

## 3. Communication avec l'API

### 3.1 Client HTTP (`ui/src/utils/LLApiClient.js`)

- **popsicle** (pas fetch, pas axios).
- `formatUrl(path)` :
  - navigateur : `/api` + path, via le proxy du serveur UI ou nginx ;
  - serveur : `http://API_HOST:API_PORT` + path.
- Chaque appel porte `Authorization: Bearer <token actif>`, lu dans `auth.tokens[activeTokenType][activeTokenId].token`.
- **Les paramètres de query sont `JSON.stringify` valeur par valeur** (`mapValues(query, JSON.stringify)`). Exemple : `?query={"name":…}&skip=0`.
- Les réponses sont `{status, body}`. Le code teste `status` manuellement ; les messages d'erreur viennent de `body.message || body.errmsg || body`.
- L'authentification et le refresh appellent popsicle directement (`ui/src/redux/modules/auth/*`), sans `LLApiClient`.

### 3.2 Authentification et tokens JWT

| Étape | Détail |
|---|---|
| Login | `POST /api/auth/jwt/password` avec Basic auth (`email.toLowerCase():password`). Réponse : JWT en `text/plain`. Le serveur pose le cookie **httpOnly** `refresh_token_user_<userId>` (path `/api/auth/jwt/refresh`, SameSite Strict, 7 jours par défaut) |
| Google | popup `window.open('/api/auth/jwt/google')`. Le front interroge `popup.location` (setTimeout 0) jusqu'à voir `?access_token=` (redirection vers `/api/auth/jwt/success`) ou `?error=` |
| Décodage | `jwt-decode`. Payload : `{userId, provider, scopes[], tokenType:'user'|'organisation'|'dashboard', tokenId, shareableId, extensions:{orgTimezone, visualisationIds}, filter, organisation, exp}`. Rangé dans `auth.tokens.user` ou `auth.tokens[type][id]` |
| Stockage | **Cookies non httpOnly** (js-cookie, cookie de session, domaine `COOKIE_DOMAIN`) : `access_token_user_<userId>` et `access_token_organisation_<orgId>`. Nommage dans `ui/src/utils/auth.js` ; `lib/constants/cookies.js` fixe `COOKIE_ACCESS_TOKEN='access_token'`. **L'API relit ces mêmes cookies** (stratégie passport `jwt-cookie`) pour les ressources chargées par `<img>` ou `<a href>` : logo, CSV d'export, CSV d'erreurs d'import |
| Organisation | `POST /api/auth/jwt/organisation {organisation}` avec le Bearer du token user. Le serveur pose `refresh_token_organisation_<orgId>` (httpOnly). Le scope du token org = scopes des rôles + scopes user ; `filter` = filtre `organisationSettings` de l'utilisateur |
| Token actif | Choisi par les gardes de route : `user` pour home et admin, `organisation/<id>` sous `/organisation/:id`, `dashboard/<id>` en embed |
| Refresh | Saga `pollRefreshTokenSaga` toutes les **10 s**. Si `exp < now + 3 min` : `POST /api/auth/jwt/refresh {id: tokenId, tokenType}`, **sans Bearer** (le cookie httpOnly fait foi). Concerne le token user et le token de l'organisation active. Réponse 401 → logout |
| Logout | Supprime tous les cookies `access_token*`, vide `tokens` (recycle de tout le store) et navigue vers `login`. **Aucun appel serveur** ; les cookies de refresh httpOnly restent en place |
| Sortie d'organisation (`orgLogout`) | Supprime les cookies et tokens d'organisation, puis navigue vers `home` |
| 401 sur un appel métier | Via `createAsyncDuck` : logout global |

### 3.3 Endpoints consommés

Tous les chemins sont préfixés par `/api`. Le préfixe REST est `/v2` (`lib/constants/routes.js`). Le CRUD REST est généré par express-restify-mongoose (`api/src/routes/HttpRoutes.js`) ; les routes sont insensibles à la casse.

| Méthode | Endpoint | Usage dans le front |
|---|---|---|
| POST | `/auth/jwt/password` | login |
| POST | `/auth/jwt/organisation` | connexion à une organisation |
| POST | `/auth/jwt/refresh` | refresh (cookie) |
| GET | `/auth/jwt/google` (popup) → `/auth/jwt/success?access_token=` | OAuth Google |
| POST | `/auth/resetpassword/request` | mot de passe oublié |
| POST | `/auth/resetpassword/reset` | réinitialisation |
| GET | `/app/googleAuth`, `/app/version` | drapeau Google, version (fond d'écran) |
| GET | `/v2/<schema>/<id>` | `fetchModel` |
| POST | `/v2/<schema>` | `addModel` |
| PATCH | `/v2/<schema>/<id>` | `saveModel`, document complet |
| DELETE | `/v2/<schema>/<id>` | `deleteModel` |
| GET | `/v2/<schema>/count?query=` | compteurs (`withModelCount`, `withSchema`) |
| GET | `/connection/<schema en minuscules>?filter=&sort=&first=&last=&after=&before=` | toutes les listes (pagination par curseur) |
| GET | `/statements/aggregateAsync?pipeline=&sinceAt=` | résultats des visualisations |
| GET | `/statements/count?query=` | compte de statements (`countModels('statement')`) |
| GET | `/statements/aggregate?pipeline=&skip=&cache=true` | `indexModels('statement')` et `getAggregation` : **non utilisés** |
| DELETE | `/v2/users/:userId/organisations/:orgId` | retirer un utilisateur de l'organisation |
| PATCH | `/v2/users/:userId/organisationSettings/:orgId` | rôles, filtre, fuseau d'un utilisateur dans l'organisation |
| POST | `/mergepersona?mergePersonaFromId&mergePersonaToId` | fusion de personas |
| POST | `/assignpersona`, `/createpersonafromidentifier` | méthodes du client **non utilisées** |
| POST | `/uploadpersonas` (multipart `id`, `file`) | upload CSV |
| POST | `/importpersonas {id}` | lancement de l'import |
| GET | `/organisation/:orgId/importpersonaserror/:id.csv` | CSV des erreurs (cookie) |
| POST | `/uploadlogo?data=<orgId>` (multipart `logo`) | logo d'organisation |
| GET | `/downloadlogo/:orgId?t=<updatedAt>` | `<img>` du logo (cookie) |
| GET | `/export?exportId=&pipelines=` | demande d'export CSV ; renvoie le modèle `download` |
| GET | URL du champ `download.url` (route `/organisation/:orgId/downloadexport/:download.csv`) | téléchargement (cookie) |
| POST | `/requestAppAccess {appConfig}` | page Sales Demo |
| GET | `/v2/siteSettings/111111111111111111111111` et PATCH | bannière d'enregistrement |

**Schémas REST et connection utilisés :** `organisation, user, lrs, client, role, dashboard, visualisation, statementForwarding, statement, query (requêtes sauvegardées), export, download, querybuildercache, querybuildercachevalue, persona, personaIdentifier, personaAttribute, personasImport, siteSettings`.

**Non exposés dans l'UI** : `batchdelete`, `statementmetadata`, `personasImportTemplate`, `/v1/statements/aggregate`, la suppression de statements et `/oauth2/token`.

### 3.4 Pagination « connection »

- **Requête :** `filter` (requête Mongo en JSON, avec les opérateurs spéciaux de 6.2), `sort` (par défaut `{createdAt:-1,_id:1}` côté front, `{_id:1}` côté serveur), `first` (10 par défaut côté serveur), `after` / `before` (curseurs opaques).
- **Réponse :** `{ edges:[{cursor, node}], pageInfo:{hasNextPage, hasPreviousPage, startCursor, endCursor} }`.
- **Côté front** (`ui/src/redux/modules/pagination/fetchModels.js`) :
  - cache par triplet `(schema, filter, sort)` ;
  - `fetchMore` passe `after = pageInfo.endCursor` ;
  - les edges sont fusionnées par diff de curseurs (`fetchModelsDiff.js`, lib `mdiff`) ;
  - cache de 3 min ;
  - `clearModelsCache(schema)` remet tous les `cachedAt` à 0 ;
  - `fetchAllOutstandingModels` recharge les pages déjà vues après invalidation.
- **Tailles de page :** 10 (listes), 12 (cartes de dashboards), 100 (identifiants, attributs, stores), 300 (dashboards), 1000 (autocomplétions et valeurs de cache).

### 3.5 Agrégation asynchrone (`ui/src/redux/modules/aggregation/fetchAggregation.js`)

- Appel : `GET /statements/aggregateAsync?pipeline=<JSON>[&sinceAt=]`.
- Réponse : `{result: [ {_id, count, model} ] | null, status:{startedAt, completedAt, isRunning}}`.
- Résultat mis en forme en `OrderedMap` indexée par `_id`. **`_id` peut être un objet**, par exemple une activité de `contextActivities`, ou `null` pour un compteur.
- **Relance après 1 s** :
  - si `result === null` (pas encore calculé) ;
  - ou si `completedAt < startedAt` (recalcul en cours ; on renvoie alors `sinceAt=completedAt`).
- La clé de cache Redux est le pipeline lui-même (Immutable).

---

## 4. Composants réutilisables et thème

**Composants (`ui/src/components`)**
- `Charts` (BarChart, ColumnChart, LineChart, PieChart, Chart, CustomTooltip, PieTooltip) ; `XvsY` (nuage de points) ; `Counter` ; `Graphs/NoData`.
- `AutoComplete` (v1, opérateurs) et `AutoComplete2` : inputs single et multi, listes d'options `ModelOptionList`, `CacheKeysOptionList`, `CacheValuesOptionList`. `ModelOptionList` gère l'**ajout, le renommage inline (`fields`) et la suppression** de modèles depuis l'autocomplétion. `QueryBuilderAutoComplete` charge jusqu'à 1000 valeurs.
- `RawQueryBuilder` : textarea JSON ; à la soumission, les `List` deviennent des `Set`. `JsonTextArea` valide le JSON et conserve la position du curseur.
- `TableInput` (éditeur clé/valeur), `MultiInput`, `Token`.
- `TimezoneSelector` : liste `lib/constants/timezones.js`, offsets `±HH:MM` et zones IANA. L'option par défaut affiche « fuseau de l'organisation ».
- `ColorPicker`, `DropDownMenu`, `Modal` (`ConfirmModal`, `ConfirmDeleteModal`), `IconButton/*` et `TextIconButton/*`, `Input` (`LabelledInput`, `TypedInput`), `Material/*` (encapsulations react-toolbox), `ScrollableTable`, `Spinner`, `SmallSpinner`, `OrgLogo`, `UserPicture`, `VisualiseIcon` (icône par type, variantes grises pour les templates et « table »), `FullPageBackground`, `SideNavFooter`, `NotFound`, `ValidationList`, `OptionList*`, `FocusGroup`.

**Conteneurs génériques (`ui/src/containers`)**
- `ModelList` et `ModelListItem` : liste dépliable ; les éléments `isNew` passent en tête ; boutons (Delete par défaut) ; propriétaire (`Owner`) ; « Load more ».
- `SearchBox` : debounce de 377 ms, écrit dans `search[schema]`.
- `DeleteButton`/`DeleteConfirm`, `EditConfirm`, `PrivacyToggleButton`/`PrivacyToggleModal` (`isPublic`), `SaveBar` (barre de progression globale), `SaveBarErrors`, `Toasts`, `ModelAutoComplete`, `CacheKeysAutoComplete`, `QueryBuilder`, `BasicQueryBuilder`.

**HOC (`ui/src/utils/hocs`)** : `withModel`, `withModels`, `withModelCount`, `withSchema`, `withPolling`, `withStatementsVisualisation`, `withOwner`, `addFilterState`. Ils correspondent à des services et resolvers Angular.

**Thème**
- `ui/src/static/core.css` (281 Ko) : Bootstrap 3.3.7, h5bp, ionicons 2.0, animate.css 3.5 et CSS maison.
- Couleur d'accent `#F5AB35` (orange) ; barre du haut `#525252`.
- Polices dans `ui/src/static/fonts` : glyphicons, ionicons, `material.woff2`. Police de texte : Arial / sans-serif.
- Logos dans `ui/src/static` (`logo.png`, `whiteLogo.png`, `smallLogo.png`, `register-logo.png`, `favicon.*`, `logos/default/default.gif`) ; fond `ui/src/assets/background.png`.
- Le reste du style est en styled-components (dossiers `styled/`) et en CSS Modules (`DashboardCard/styles.css`, `DashboardList/styles.css`, `SettingsAppsPage/styles.css`).
- Palette des parts de camembert (`ui/src/utils/colors.js`) : dégradé d'opacité de 0,2 à 1 sur la couleur de la série.

---

## 5. Internationalisation, accessibilité, tests

- **i18n : aucune.** Tous les libellés sont en anglais, codés en dur. `og:locale=en_GB`.
  - Les champs xAPI multilingues (`display`, `definition.name`) sont choisis selon `navigator.languages`, sinon la première langue disponible (`ui/src/utils/xapi.js` `displayLangMap`, `Charts/Chart.js` `getLabel`).
  - Les nombres sont formatés avec `toLocaleString`, ou `numeral('0.[0]a')` pour le compteur. Les dates passent par moment (`fromNow`, `ddd DD MMM YYYY h:mm:ss`).
- **Accessibilité : minimale.** Il y a quelques `aria-label="Close"`, des `sr-only` et des `htmlFor`. La plupart des actions sont des `<a onClick>` ou `<span onClick>` sans rôle ni gestion clavier. La config eslint inclut jsx-a11y.
- **Tests :** 42 fichiers `*.spec.js` (jest 19, enzyme, snapshots). Ils couvrent :
  - les graphiques ;
  - `SourceResults` (`generateTableData`, `calcStats`) ;
  - `grouper` (`ui/src/utils/visualisations/aggregationGroup/grouper/index.spec.js`) ;
  - le sélecteur de pipelines (`ui/src/redux/modules/visualise.spec.js`) ;
  - la pagination (`fetchModels.spec.js`, 640 lignes) ;
  - les critères du query builder (Boolean, Range, Continuous) ;
  - `RoleForm`, `ClientForm`, `PersonasImport` ;
  - `dates`, `defaultTitles`, `schemas`, `dashboard` (URL de partage) et `has$dte`.
  - Ces specs et leurs snapshots sont **des oracles réutilisables** pour valider la parité de la logique portée.
  - `ui/src/redux/modules/tests/queryBuilder-test.js` est au format mocha.

---

## 6. Logique métier côté client à porter (principal risque de régression)

### 6.1 Formats persistés : JSON sérialisé en chaîne par le front

Ces transformations sont faites par `preSave` et `reviver` dans `ui/src/utils/schemas.js`. **La base les contient sous cette forme ; l'API attend des chaînes.** Le modèle `lib/models/visualisation.js` valide « JSON string dont la valeur est un objet non tableau ».

| Modèle.champ | Stockage | Remarques |
|---|---|---|
| `visualisation.filters[]` | **tableau de chaînes JSON**, chacune `{"$match":{…},"label"?,"color"?}` | défaut `[{"$match":{}}]` |
| `visualisation.axesgroup`, `axesvalue`, `axesxValue`, `axesyValue`, `axesxQuery`, `axesyQuery`, `axesquery` | **chaînes JSON** (`{"optionKey","searchString","contextActivityDefinitionType"?}`, ou `{"$match":…}` pour les queries) | liste `axesToJsList` dans `lib/helpers/visualisation.js`. `preSave` écrit `JSON.stringify(item ? item.toJS() : null)`, donc `"null"` pour une requête désactivée |
| `visualisation.axes` | chaîne JSON, **obsolète** | `preSave` force `JSON.stringify(axes || {})`, donc `"{}"` |
| `visualisation.axesxLabel`, `axesyLabel`, `axesoperator`, `axesxOperator`, `axesyOperator` | chaînes simples | |
| `visualisation.*` | autres champs : `type`, `description`, `stacked`, `trendLines`, `sourceView`, `showStats`, `statsAtBottom`, `isDonut`, `isPublic`, `barChartGroupingLimit`, `benchmarkingEnabled`, `contextLabel`, `previewPeriod`, `timezone`, `owner`, `suggestedStep` | |
| `statementForwarding.query` | chaîne JSON | |
| `statementForwarding.configuration.headers` | chaîne JSON | |
| `user.organisationSettings[].filter` | chaîne JSON (`"{}"` si vide) | aussi envoyée en chaîne via `PATCH …/organisationSettings` |
| `query.conditions` (requêtes sauvegardées) | chaîne JSON | `SavedQueries` relit chaîne ou objet |
| `client.authority` | chaîne JSON (agent xAPI) | |
| `dashboard.shareable[].filter` | chaîne JSON (`"{}"` par défaut) | `dashboard.widgets[]` = `{_id, title, visualisation(ObjectId), x, y, w, h}` |
| `export.projections[]` | tableau de chaînes JSON (`OrderedMap` à la relecture : **l'ordre des clés compte** pour les colonnes CSV) | `rawMode` |

À reproduire en Angular : une couche de « mappers » par entité, en lecture et en écriture. **L'ordre des clés** des projections et des requêtes doit être préservé.

### 6.2 Langage de requête du Query Builder

Fichiers : `ui/src/redux/modules/queryBuilder.js`, `ui/src/utils/queries/index.js`, `ui/src/containers/BasicQueryBuilder/**`.

**Format.** Le query builder produit le contenu d'un `$match` :

```js
{ "$and": [
    { "$comment": "{\"criterionLabel\":\"A\",\"criteriaPath\":[\"statement\",\"verb\"]}",
      "statement.verb.id": { "$in": ["http://…"] } },          // ou $nin (« Out »)
    { "$comment": "{…\"criteriaPath\":[\"statement\",\"actor\"]}",
      "$or": [ { "statement.actor.mbox": "mailto:…" }, … ] },   // ou $nor
    { "$comment": "…[\"timestamp\"]", "timestamp": { "$gt": { "$dte": "2019-02-03T09:00+01:00" } } },
    { "$comment": "…", "statement.result.score.scaled": { "$gte": 0.5 } },
    { "$comment": "…", "person._id": { "$in": [ { "$oid": "…" } ] } },
    { "$comment": "…", "person._id": { "$personaIdent": { "key": "persona.import.xxx", "value": "…" } } }
] }
```

**Règles**
- Chaque critère est un élément de `$and`. Son `$comment` porte un JSON `{criterionLabel, criteriaPath}`.
  - Les labels sont générés A, B, …, Z, AA… (`getNextLabel` et `incrementLabel`).
  - **Migration legacy** : un `$comment` qui n'est pas du JSON (ancien format `"statement.verb"`) est converti à la lecture (`getCriterionFromOldComment`).
- `changeCriteria` : si la liste est vide, la requête devient `{}`, sinon `{$and: list}`.
- **Opérateurs spéciaux résolus par le backend** (`lib/helpers/parseQuery.js`) :
  - `$dte` : date ISO ;
  - `$oid` : ObjectId ;
  - `$personaIdent` : résolu en `{$in:[personaIds]}` via les attributs de persona ;
  - `$lookup` est filtré et `$out` retiré.
- **Sections** (`initialSections`) :
  - **Who** : `person._id` (`$in` de `$oid`, source `persona`). Sous-sections « Additional Data » (`persona.import.*` via `$personaIdent`) et « Actor » (`$or`/`$nor` d'IFI).
  - **Did** : `statement.verb.id`, `$in`.
  - **What** : `statement.object.id`. Sous-sections Type (`statement.object.definition.type`) et Extensions (générées).
  - **Where** : `statement.context.*`, généré.
  - **Metadata** : `metadata.*`, généré.
  - **Result** : Scaled, Raw, Max et Min en plage (`$gt`, `$gte`, `$lt`, `$lte`, `$eq`, `$ne`) ; Response en correspondance de chaîne `$in`/`$nin` ; Complete et Success en booléen ; plus les sous-chemins générés.
  - **When** : `timestamp` et `stored` en continu, avec un date-time `{"$dte": "YYYY-MM-DDTHH:mmZ"}`.
  - **Store** : `lrs_id`, `$in` de `$oid`.
- **Sous-sections générées** depuis `querybuildercache`. Ce sont des documents `{path:[segments], searchString, valueType}` ; les points sont encodés `&46;` (`lib/helpers/encodeDot.js` et `decodeDot.js`).
  - Filtre de chargement (`ExpandedSection.queryBuilderCacheFilterGenerator`) : `{$and:[{$or:[{"path.0":{$eq:…},…}]},{path:{$size:n+1}}]}`.
  - `valueType === 'Number'` donne l'opérateur de plage.
  - `contextActivities.<type>` utilise `$in` sur `…<type>.id`.
  - `context.instructor` utilise `$or`.
- **Valeurs proposées** : `querybuildercachevalue` filtrées sur `{path:{$eq:'a.b.c'}}`. Le libellé vient du champ `display` ; à défaut, il est calculé (`displayAuto`, `displayActor`, `displayVerb`, `displayActivity`).
- **Ajout depuis l'explorateur** (`addTokenToQuery`) :
  - les chemins `person`, `statement.verb` et `statement.object` ajoutent la valeur au `$in` ou `$nin` existant ;
  - les autres ajoutent un élément au `$or` ou `$nor` existant ;
  - sinon un nouveau critère est créé.
  - `valueToCriteria` aplatit un objet xAPI : un agent donne ses IFI, une activité donne `{id}`, un document Mongo donne `{_id:{$oid}}`. Le résultat est un ensemble de clés pointées.
- **Mode raw** : JSON libre ; les tableaux deviennent des `Set` Immutable (sans doublons).
- **Requêtes sauvegardées** (`ui/src/containers/QueryBuilder/SavedQueries.js`) : schéma `query` avec `{name, conditions}`. Actions : charger, mettre à jour (désactivé si les requêtes sont identiques) et créer depuis l'autocomplétion (`defaultNewValues:{conditions}`).
- **Boutons du query builder** : rafraîchir (vide le cache `statement`), vider, basculer basic/raw.
- **Fuseau** : `update$dteTimezone(query, tz)` (`lib/helpers/update$dteTimezone.js`) réécrit chaque `$dte` en gardant la date et l'heure « murales » avec l'offset du fuseau. Pour un fuseau `±HH:MM`, l'offset est utilisé tel quel. Cette réécriture est appliquée :
  - dans la page Source à chaque rendu ;
  - au changement de fuseau d'un statement forwarder, d'un partage de dashboard ou d'un utilisateur ;
  - à chaque construction de pipeline.

### 6.3 Construction des pipelines d'agrégation (`ui/src/utils/visualisations`)

**Entrée** : `visualisationPipelinesSelector` dans `ui/src/redux/modules/visualise.js`.

1. `timezone = visualisation.timezone || token.extensions.orgTimezone || organisation.timezone || 'UTC'`.
2. `queries = filters.map(f => filtreDashboard ? {$match:{$and:[f.$match, ...filtreDashboard]}} : f)`.
   - En vue normale, `filtreDashboard = [{}]` : la requête est **toujours enveloppée** dans `$and:[f.$match, {}]`.
   - Exception : pas d'enveloppe si le sélecteur renvoie une valeur vide.
3. `axes = unflattenAxes(visualisation)` : les clés `axes*` deviennent `group`, `value`, `operator`, `xValue`…
4. Appel `pipelinesFromQueries(queries, axes, type, previewPeriod, journey/id, timezone, benchmarkingEnabled)`.

**`pipelinesFromQueries`**
- `currentMoment = moment().utc().startOf('minute')` : le pipeline change chaque minute, ce qui provoque un nouvel appel.
- Avec benchmark activé : pour chaque requête, `[pipeline courant, pipeline de la période précédente]` (`flatten(1)`).

**`pipelineFromQuery`** (mémoïsé sur `toJS()`)
- `preReqs = [ {$match:{timestamp:{$gte:{$dte: periodToDate(previewPeriod,tz,now).toISOString()}}}} ]`.
  - Benchmark : `{$gte: P2, $lte: P1}` ;
  - plus `{$match: update$dteTimezone(query.$match, tz)}` si non vide.
- `periodToDate` (`ui/src/utils/dates.js`) :
  - `TODAY` = début du jour dans le fuseau, **sans multiplicateur de benchmark** (bug : la fenêtre précédente est vide) ;
  - `LAST_24_HOURS` = −24h×k ;
  - `LAST_7_DAYS` = −7j×k, et c'est aussi le défaut ;
  - `LAST_30_DAYS` = −30j×k ;
  - `LAST_2_MONTHS` = −2 mois×k ; `LAST_6_MONTHS` = −6 mois×k ;
  - `LAST_1_YEAR` = −1 an×k ; `LAST_2_YEARS` = −2 ans×k.
- Aiguillage par type :
  - `aggregateChart` (LEADERBOARD, PIE, STATEMENTS, FREQUENCY et templates associés) : `[preReqs ++ grouper(...)]`, avec par défaut value=`statements`, group=`date`, op=`uniqueCount` ;
  - `aggregateXvsY` : deux pipelines `[preReqs ++ {$match:axes.xQuery.$match}? ++ grouper(x)]` puis l'équivalent pour y. Par défaut value=`'statement'` (**au singulier, incohérent**) ;
  - `aggregateCounter` : `[preReqs ++ counter(...)]`.

**`grouper`** (`aggregationGroup/grouper/index.js`)
- `valueOpCase` (`helpers/valueOpCase.js`) :
  - `count`, `average`, `max`, `min` donnent `value` ;
  - `uniqueCount` donne `uniqueStatementCount` si la valeur est `statements`, sinon `uniqueCount` ;
  - `uniqueAverage`, `uniqueMax`, `uniqueMin` donnent `uniqueStatementModifier` si la valeur est `statements`, sinon `uniqueModifier`.
- Opérateurs Mongo (`getOperator`) : count et uniqueCount → `$sum` ; average → `$avg` ; max → `$max` ; min → `$min`.
- **Étape 1**
  - Groupe `persona.import.<attr>` :
    ```
    $lookup {from:'personaAttributes', as:'personaAttrs', let:{personaId:'$person._id'}, pipeline:[{$match:{$expr:{$and:[{$eq:['$personaId','$$personaId']},{$eq:['$key',attr]}]}}}]}
    → $match {personaAttrs:{$exists:true}} → $unwind {path:'$personaAttrs'} → $match {'personaAttrs.key':attr}
    ```
    Ensuite le groupe devient `personaAttrs.value`.
  - Sinon : `$match` d'existence (omis s'il est vide), selon le cas :
    - `value` / `uniqueCount` : `keyExists(value) ∪ keyExists(group)` ;
    - `uniqueModifier` : `keyExists(value)` ;
    - `uniqueStatementCount` : `keyExists(group)` ;
    - plus `$unwind {path:'$<group>'}` si le groupe commence par `statement.context.contextActivities.`.
  - `keyExists` (`helpers/keyExists.js`) :
    - `scaled` → `statement.result.score.scaled` ;
    - `raw` → `…score.raw` ;
    - `response` → `statement.result.response` ;
    - `steps` → `statement.object.definition.extensions.http://lrs&46;learninglocker&46;net/define/extensions` ;
    - `people` → `person._id` ;
    - `type` → `statement.object.definition.type` ;
    - activities, verb, statements et les périodes → `{}` ;
    - sinon `{<clé>:{$exists:true}}`.
- **Étape 2** : `$match {'<group>.definition.type': contextActivityDefinitionType}` si c'est un contextActivities et qu'un type est choisi.
- **Étape 3** : `$project`, selon le cas :
  - `value` / `uniqueCount` : `{group, value, model}` ;
  - `uniqueStatementModifier` : `{date, timestamp:'$timestamp', model}` ;
  - `uniqueModifier` : `{date, timestamp, value, model}` ;
  - `uniqueStatementCount` : `{group, model}`.
  - Projections :
    - `group` (`projections/group.js`) :
      - `people` → `$person._id` ;
      - `activities` → `$statement.object.id` ;
      - `verb` → `$statement.verb.id` ;
      - `type` → `$statement.object.definition.type` ;
      - `raw` → `$statement.result.score.raw` ;
      - `response` → `$statement.result.response` ;
      - périodes : `date` = `$dateToString {format:'%Y-%m-%d', date:'$timestamp', timezone}`, `minute` = `$minute`, `hour` = `$hour`, `weekday` = `$dayOfWeek`, `month` = `$month`, `year` = `$year`, chacun sous la forme `{date:'$timestamp', timezone}` ;
      - sinon `'$'+groupType`.
    - `value` (`projections/value.js`) :
      - `scaled` → `$statement.result.score.scaled` ;
      - `raw` → `$statement.result.score.raw` ;
      - `response` → `$statement.result.response` ;
      - `steps` → `$statement.object.definition.extensions.http://lrs&46;learninglocker&46;net/define/extensions/steps` ;
      - `people` → `$person._id` ;
      - `activities` → `$statement.object.id` ;
      - `verb` → `$statement.verb.id` ;
      - `type` → `$statement.object.definition.type` ;
      - `statements` → `$_id` ;
      - sinon `'$'+valueType`.
    - `model` (`projections/model.js`) :
      - `people` → `$person.display` ;
      - `activities` → `{objectType:'$statement.object.objectType', id:'$statement.object.id', definition:{name:'$statement.object.definition.name'}}` ;
      - `verb` → `$statement.verb` ;
      - `raw`, `response` et `type` → comme `group` ;
      - périodes → comme `group` ;
      - sinon `'$'+groupType`.
    - `date` (`projections/date.js`) : `$dateToString` avec les formats minute `%Y-%m-%dT%H-%M`, hour `%Y-%m-%dT%H`, weekday `%Y-%m-%d`, month `%Y-%m`. Sinon la chaîne `'PROBLEM IN DATE PROJECTION'`.
- **Étape 4** : `$group`. `firstValuesOf(projections)` ajoute `{clé:{$first:'$clé'}}` pour chaque projection.
  - `value` : `{_id:'$group', count:{<op>:'$value'}, …first}` ;
  - `uniqueStatementCount` : `{_id:'$group', count:{$sum:1}, …}` ;
  - `uniqueCount` : `{_id:{group:'$group', value:'$value'}}`, puis `{_id:'$_id.group', count:{$sum:1}}` ;
  - `uniqueStatementModifier` : `{_id:'$date', count:{$sum:1}}`, puis `{_id: buildPeriodGroupKey(groupType,tz), count:{<op>:'$count'}}` ;
  - `uniqueModifier` : `{_id:{date,value}}`, puis `{_id:'$_id.date', count:{$sum:1}}`, puis `{_id: periodKey, count:{<op>:'$count'}}`.
  - `buildPeriodGroupKey` : `$minute`, `$hour`, `$dayOfWeek` ou `$month` ; sinon la chaîne `'PROBLEM IN PERIOD PROJECTION'`. **Les opérateurs `unique*Modifier` n'ont de sens qu'avec un groupe minute, hour, weekday ou month.**
- **Étape 5** : `{$sort:{count:-1}}`, `{$limit:10000}` (`RESPONSE_ROWS_LIMIT`), `{$project:{_id:1,count:1,model:1}}`.

**`counter`** (`aggregationGroup/counter/*`)
- `$match` d'existence puis `$project` :
  - `value` / `uniqueCount` : `{value}` ;
  - modificateurs : `{group}` ;
  - `uniqueStatementCount` : rien.
- Puis :
  - `value` : `{_id:null, count:{<op>:'$value'}}` ;
  - `uniqueStatementCount` : `{_id:null, count:{$sum:1}}` ;
  - `uniqueCount` : `{_id:'$value'}`, puis `{_id:null, count:{$sum:1}}` ;
  - modificateurs : `{_id:'$group', count:{$sum:1}}`, puis `{_id:null, count:{<op>:'$count'}}`.

**Déclenchement** (`watchFetchVisualisation`)
- Pour chaque série et chaque pipeline : `fetchAggregation` si l'état n'est pas encore demandé.
- `withStatementsVisualisation` réévalue à chaque rendu.
- Le spinner reste affiché tant que tous les pipelines n'ont pas de résultat.

### 6.4 Contrainte croisée front/back : autorisation des dashboards embarqués

`lib/services/statements/utils/checkDashboardAuth.js`, avec un token `dashboard` :
1. Le serveur relit les visualisations des widgets.
2. Il reconstruit leurs requêtes : `{$match:{$and:[viz.$match, JSON.parse(shareable.filter)]}}`.
3. Il retire du pipeline client le dernier élément du `$and` (le filtre d'URL) quand `filterMode` vaut ANY ou JWT et que le `$and` a plus de 2 éléments.
4. Il recalcule `pipelinesFromQueries(...)` **avec le code de `ui/src/utils/visualisations`**, puis exige `immutPipelines.contains(immutPipeline)`.

Le fuseau utilisé côté serveur est `visualisation.timezone || organisation.timezone || 'UTC'`.

`aggregate.js` (`dashboardPipeline`) : en mode JWT, l'élément `pipeline[1].$match.$and[2]` est vérifié par `jwt.verify(…, filterJwtSecret)` puis remplacé par le payload. S'il est absent alors que `filterRequired` est vrai : erreur.

**Conséquences pour Angular**
- Le TypeScript qui construit les pipelines doit produire **la même structure exacte** : mêmes étapes, mêmes valeurs, même enveloppe `$and`. L'égalité Immutable des Map ignore l'ordre des clés, mais les listes et les chaînes comptent.
- Il doit aussi utiliser la **même troncature à la minute** de `now`. Il existe un risque de bord à la minute près, déjà présent aujourd'hui.
- La solution la plus sûre est d'extraire `ui/src/utils/visualisations/**`, `ui/src/utils/dates.js`, `lib/helpers/update$dteTimezone.js` et `lib/helpers/visualisation.js` dans un **package partagé** (JS/TS sans React ni Immutable, ou avec), consommé par le backend et par Angular. Les specs existantes (`grouper/index.spec.js`, `visualise.spec.js`) servent de tests de non-régression.

### 6.5 Post-traitement des résultats et rendu

**`getFormattedResults(groupOptionKey, results)`** (`ui/src/utils/visualisationResults/getFormattedResults.js`). `results` = `List<série> → List<axe> → OrderedMap<_id,{_id,count,model}>`.
- `hour` : 24 entrées de 0 à 23. Absent → count 0.
- `weekday` : 7 entrées Sun…Sat, lues aux `_id` 1–7 (`$dayOfWeek`).
- `month` : 12 entrées Jan…Dec, lues aux `_id` 1–12.
- `date` : **comble tous les jours** entre la date min et la date max observées, toutes séries confondues, au format `YYYY-MM-DD`, avec count 0.
- Les autres groupes (`year`, `minute`, objets…) sont laissés tels quels.

**Fusion des séries** (`ui/src/components/Charts/Chart.js`)
- Clé de ligne `cellId` : l'`_id` s'il est une chaîne ou un nombre, sinon `getLabel(_id)` (name, puis id, puis `definition.name` selon la langue).
- Colonnes `Series 1..n` (0 si absente), plus `total` = somme.
- Libellé affiché : `displayAuto(model)`, tronqué par `trimName` (17 caractères) avec ces règles, dans l'ordre :
  - dernier segment après `/` ;
  - sinon partie avant `@` ;
  - sinon dernier mot ;
  - sinon après le dernier `.` ;
  - sinon `substr(0,12)+' '+substr(12,12)` ;
  - puis `…` si le résultat reste trop long.

**Tri par type**
- Barres (`BarChart.js`) : tri par `total` décroissant. **Pagination client** par `barChartGroupingLimit` (boutons Previous / Next, `metadata.activePage`). Le nombre de pages vaut `ceil(n / (limit+1))` : c'est un bug, à décider.
- Colonnes et lignes : tri par `id` croissant.
- Camembert : tri par `total` croissant. Un anneau par série ; couleur de part = couleur de série en opacité dégradée de 0,2 à 1 (`getColor`).
- Barres et colonnes : `stackId` commun si `stacked`. Clic sur la légende : masque ou affiche une série (`hiddenSeries`).
- Libellés d'axes : `axes*Label`, sinon `searchString` de la valeur ou du groupe.

**XvsY** (`ui/src/components/XvsY/index.js`) : fusion des résultats x et y par `_id`, points `{x: count_x, y: count_y}` (0 si absent). L'infobulle liste tous les modèles à la même position.

**Counter** (`ui/src/components/Counter/index.js`)
- `count = results[0][0].get(null).count`.
- Benchmark : `prev = results[1][0][null].count`.
- `getPercentage` (`ui/src/utils/defaultTitles.js`) : `round((new-old)/new*100)`. Résultat « N/A » si l'ancienne valeur vaut 0 ou si le calcul donne NaN. Chevron haut ou bas selon le signe, plus « (last 7 days) » dérivé de `previewPeriod`.
- Affichage `numeral('0.[0]a')`, infobulle `toLocaleString`, `contextLabel` sous le nombre. La taille de police dépend de la taille du widget.

**Vue tableau `SourceResults`** (`ui/src/containers/VisualiseResults/SourceResults.js`)
- Une ligne par `_id`, des colonnes par série puis par axe. XvsY a 2 sous-colonnes.
- Libellés d'en-tête selon le type (`getGroupAxisLabel`, `getValueAxisLabel`).
- Statistiques `calcStats` par série et par axe : Total, Average, Max, Min, Row Count. Affichées en haut ou en bas (`showStats`, `statsAtBottom`).
- Nombres à 2 décimales s'ils ne sont pas entiers.
- Message « Totals calculated from the first 10,000 records » si un axe a exactement 10 000 lignes.

**Titre par défaut** `createDefaultTitle(model)` (`ui/src/utils/defaultTitles.js`), utilisé dans les listes et les widgets. Exemples :
- Bar : `X: <Group> Y: <op><Value>` ;
- Pie : `<op><value> / <group>` ;
- Counter : `<op><value>`.
- L'opérateur `uniqueCount` n'est pas affiché ; les autres utilisent le libellé `OPERATOR_OPTS` suivi d'une espace. Les mots passent par `startCase(toLower(...))`.

### 6.6 Dashboards partagés : filtres et URL

**`getShareableUrl`** (`ui/src/utils/dashboard.js`)
- Base : `origin/dashboards/<dashboardId>/<shareableId>/<titre encodé, espaces → '-'>`.
- `filterMode=ANY` : ajoute `?filter={}`.
- `filterMode=JWT_SECURED` avec un secret : ajoute `?filter=<jwt.sign({}, filterJwtSecret, {noTimestamp:true})>`. **La signature HS256 se fait dans le navigateur.**

**`shareableDashboardFilterSelector`** (`ui/src/redux/modules/visualise.js`)
- **En embed :**
  - le filtre vaut `[shareable.filter]` ;
  - lien legacy sans `shareableId` : le premier partage ;
  - avec un paramètre `filter` et `filterMode !== OFF` : `[shareable.filter, urlFilter]`. En mode ANY, `urlFilter = JSON.parse(decodeURI(filter))`, ou `{}` si invalide. En mode JWT, le JWT brut est mis dans le `$and` et le serveur le vérifie puis le remplace.
- **Dans l'application** : si un partage est déplié dans le panneau Share, son filtre s'applique à tout le dashboard pour la prévisualisation.

### 6.7 Création, copie et sauvegarde

- **Modèles de dashboard** : layouts de widgets exacts dans `ui/src/redux/modules/dashboard/gettingStarted.js` et `streamStarter.js`.
- **Copie d'une visualisation** : retire `_id`, `updatedAt`, `createdAt`, `__v` et `owner`, puis met le user courant comme `owner`. Le `POST` envoie la visualisation désérialisée, et le `preSave` la resérialise.
- **Nouvel enregistrement** : `POST` avec `isExpanded:true` dans le corps. Le serveur ignore ou stocke ce champ selon le schéma.
- **Saisie** : les modifications sont toujours appliquées en local puis sauvegardées par `PATCH` du document complet après 1 s. `SaveBar` affiche la progression ; les erreurs de validation remontent par champ (`model.errors.messages`).

### 6.8 Règles d'UI dérivées des scopes

- `canViewModel(model)` (`lib/services/auth/canViewModel.js`) : menus Settings et People, gardes de route.
- `canCreateOrganisations` (`lib/services/auth/canCreateOrganisations.js`) : `org/all/organisation/manage`, `site_admin`, `site_can_create_org`, ou `all` si `RESTRICT_CREATE_ORGANISATION` est faux.
- `isSiteAdmin` : scope `site_admin` dans le token actif.
- Bouton Switch organisation : visible si `user.organisations` n'est pas vide.
- **Matrice des rôles** (`ui/src/pages/SettingsRolesPage/RoleForm.js` + `lib/helpers/scopes.js`, `lib/constants/orgScopes.js`) :
  - scopes groupés par préfixe, libellés « View », « Edit », « Manage » ;
  - cocher `…/edit` ajoute `…/view` ;
  - cocher `org/all/x` ajoute `org/public/x` ;
  - cocher `all` ajoute tous les scopes ;
  - décocher retire les dépendants.
  - L'algorithme `generateNewScopes` est à porter tel quel ; il est couvert par `RoleForm.spec.js`.

### 6.9 Autres règles côté client

- **Validation du mot de passe** : `lib/utils/validators/User.validatePasswordUtil` (longueur, lettre, chiffre, regex personnalisée, message), plus la vérification de la confirmation.
- **Validation des IFI** : `hasIdentifierValueErrors` (`ui/src/pages/PeopleManagePage/IdentifiersEditor/hasIdentifierValueErrors.js`), basée sur les regex iri et mailto de `@learninglocker/xapi-validation`.
- **Import de personas** : helpers de structure de colonnes dans `lib/services/importPersonas/personasImportHelpers.js`.
- **Code d'enregistrement** : `LLOSREG2021` codé en dur ; `sessionStorage.proceedOnce`.
- **Alertes** : durée d'affichage `max(2000, longueur × 100 ms)`. Les erreurs 404 et `ValidationError` sont masquées des alertes. Les toasts restent 10 s.

---

## 7. Pièges et dettes à arbitrer (reproduire ou corriger)

1. Une ressource `<img>` ou `<a>` authentifiée dépend des cookies `access_token_*` **lisibles en JS**. Une SPA qui garderait le token en mémoire seulement casserait le logo, l'export CSV et le CSV d'erreurs. Il faut garder ces cookies, ou passer à un téléchargement en blob avec Bearer.
2. Le logout ne révoque rien côté serveur ; les cookies de refresh httpOnly persistent.
3. Le `PATCH` envoie le document complet. Risque de surécriture concurrente, et de champs serveur renvoyés (`organisationSettings`, etc.).
4. L'UI annonce une regex pour `validDomains`, alors que le serveur utilise un glob micromatch.
5. Le benchmark `TODAY` produit une fenêtre précédente vide.
6. La pagination des barres utilise `ceil(n/(limit+1))`.
7. `aggregateXvsY` a pour valeur par défaut `'statement'` au singulier.
8. Précédence `||`/`&&` dans `PersonasImportForm`.
9. `getAppDataSelector('ENABLE_SINGLE_STATEMENT_DELETION')` lit une clé jamais injectée : un objet Map vide est passé à `getXapiScopes`. Il faudrait sans doute lire `ENABLE_STATEMENT_DELETION`.
10. Code mort à ne pas porter :
    - `journey` / `JOURNEY_PROGRESS` (constantes absentes) ;
    - `containers/RecalcButton` et `AttemptCell` (le module `journeys` est inexistant) ;
    - `utils/aggregation.js` (pipelines prédéfinis non utilisés) ;
    - `indexModels`, `getAggregation`, `assignPersona`, `createPersonaFromIdentifier` ;
    - `containers/Organisation` et `OrgForm` ;
    - `importcsv` / `modelsWorker` ;
    - `watchUpdateVisualisation`, qui lit `action.keyPath` inexistant : `suggestedStep` n'est jamais recalculé.
11. Routes orphelines : `organisation.people`, `organisation.settings`, `organisation.people.reconcile`, `organisation.data.dashboards.add` et `admin`.
12. La version du serveur de rendu inclut le code Redux complet uniquement pour poser le token dashboard. En Angular, un simple endpoint, ou un BFF qui injecte `<script>window.__data={auth…}</script>`, suffit. Il faut alors **conserver le comportement des en-têtes `X-Frame-Options` / visibility / referer**.
13. Avec Angular et un `HttpClient` (`HttpParams`), il faut reproduire `JSON.stringify` sur chaque paramètre (`filter`, `sort`, `query`, `pipeline`, `pipelines`) et l'encodage URL.

## 8. Équivalents Angular suggérés

| Redux / React | Angular |
|---|---|
| store Redux | NgRx Signal Store ou services à signals |
| `createAsyncDuck` | effets avec `exhaustMap` (dé-duplication) |
| `withModel` / `withModels` | services `EntityStore<T>` par schéma, avec cache de 3 min et curseurs |
| router5 et ses gardes | `Router` avec `canActivate` fonctionnels (même arborescence d'URL, `trailingSlash`) |
| recharts | ngx-charts, ECharts ou D3, à réécrire composant par composant en respectant 6.5 |
| react-grid-layout | `angular-gridster2` (12 colonnes, `rowHeight` 50, `minW` 3, `minH` 4) |
| react-toolbox et Bootstrap 3 | Angular Material/CDK, avec reprise des couleurs `#F5AB35` / `#525252` |
| HOC de polling | `timer` + `takeWhile` |

**Priorité absolue :** extraire et tester la logique pure. Dans l'ordre :
1. pipelines (6.3) ;
2. formats sérialisés (6.1) ;
3. query builder (6.2) ;
4. mise en forme des résultats (6.5) ;
5. URL de partage et filtres (6.6).

Les specs Jest listées en section 5 servent d'oracles.
