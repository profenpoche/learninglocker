// Scénario golden : toutes les routes de l'API Learning Locker et du service xAPI, sur l'état
// exact de l'instantané du jeu de test (tools/seed). Lectures d'abord, écritures ensuite.
//
// Conventions d'identifiants : <section>.<sous-section>.<cas>. Un identifiant ne change jamais :
// c'est la clé de comparaison entre deux enregistrements.
import { buildWorld, createRng, VERBS, ENT_HOMEPAGE } from '../seed/statements.mjs';
import { signJwt, decodeJwt } from './lib/runner.mjs';

const USER_PASSWORD = 'Utilisateur-Test-2026';

export default async function scenario(R) {
  const m = R.manifest;
  const world = buildWorld(createRng(m.seed));
  const ref = new Date(m.referenceDate);
  const daysAgo = (d) => new Date(ref.getTime() - d * 86400000).toISOString();
  const orgId = m.organisation.id;
  const lrsMain = m.lrs.main;
  const lrsSecond = m.lrs.second;
  const learner = world.learners[0].actor;
  const accountLearner = world.learners[45].actor;
  const course = world.courses[0].id;
  const verb = (k) => VERBS[k][0];

  // -------------------------------------------------------------------------
  // 0. Divers sans authentification
  await R.req('misc.root', { path: '/api' });
  await R.req('misc.googleAuth', { path: '/app/googleAuth' });
  await R.req('misc.version', { path: '/app/version', mode: 'status' });
  await R.req('misc.oauth2Failed', { path: '/oauth2/failed' });
  await R.req('misc.unknownRoute', { path: '/route-inexistante' });

  // -------------------------------------------------------------------------
  // 1. Authentification
  const login = async (id, email, password) => R.req(id, { method: 'POST', path: '/auth/jwt/password', headers: { Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}` } });
  const adminLogin = await login('auth.login.admin', m.admin.email, m.admin.password);
  const adminToken = adminLogin.body;
  const adminId = decodeJwt(adminToken).userId;
  R.setAuth('admin', { bearer: adminToken });
  const refreshCookie = adminLogin.headers.getSetCookie().find((c) => c.startsWith(`refresh_token_user_${adminId}=`))?.split(';')[0];

  await login('auth.login.badPassword', m.admin.email, 'mauvais-mot-de-passe');
  await login('auth.login.unknownUser', 'inconnu@profenpoche.test', 'peu-importe-2026');
  await login('auth.login.upperCaseEmail', m.admin.email.toUpperCase(), m.admin.password);
  await R.req('auth.login.noHeader', { method: 'POST', path: '/auth/jwt/password' });

  const orgLogin = await R.req('auth.org.admin', { as: 'admin', method: 'POST', path: '/auth/jwt/organisation', json: { organisation: orgId } });
  R.setAuth('org', { bearer: orgLogin.body });
  const orgRefreshCookie = orgLogin.headers.getSetCookie().find((c) => c.startsWith(`refresh_token_organisation_${orgId}=`))?.split(';')[0];
  await R.req('auth.org.subOrganisation', { as: 'admin', method: 'POST', path: '/auth/jwt/organisation', json: { organisation: m.subOrganisations.active } });
  await R.req('auth.org.expiredOrganisation', { as: 'admin', method: 'POST', path: '/auth/jwt/organisation', json: { organisation: m.subOrganisations.expired } });
  await R.req('auth.org.unknownOrganisation', { as: 'admin', method: 'POST', path: '/auth/jwt/organisation', json: { organisation: '5f0000000000000000000000' } });
  await R.req('auth.org.noToken', { method: 'POST', path: '/auth/jwt/organisation', json: { organisation: orgId } });

  for (const key of ['analyste', 'observateur', 'referent', 'filtre']) {
    const u = m.users[key];
    const l = await login(`auth.login.${key}`, u.email, USER_PASSWORD);
    R.setAuth(`${key}.user`, { bearer: l.body });
    const o = await R.req(`auth.org.${key}`, { as: `${key}.user`, method: 'POST', path: '/auth/jwt/organisation', json: { organisation: orgId } });
    R.setAuth(key, { bearer: o.body });
  }

  await R.req('auth.refresh.user', { method: 'POST', path: '/auth/jwt/refresh', json: { tokenType: 'user', id: adminId }, headers: { Cookie: refreshCookie } });
  await R.req('auth.refresh.organisation', { method: 'POST', path: '/auth/jwt/refresh', json: { tokenType: 'organisation', id: orgId }, headers: { Cookie: orgRefreshCookie } });
  await R.req('auth.refresh.noCookie', { method: 'POST', path: '/auth/jwt/refresh', json: { tokenType: 'user', id: adminId } });
  await R.req('auth.refresh.badCookie', { method: 'POST', path: '/auth/jwt/refresh', json: { tokenType: 'user', id: adminId }, headers: { Cookie: `refresh_token_user_${adminId}=abc` } });
  await R.req('auth.success', { path: '/auth/jwt/success', query: { access_token: adminToken } });

  // Jetons fabriqués avec APP_SECRET : expiré, mauvaise signature
  const claims = decodeJwt(orgLogin.body);
  const now = Math.floor(Date.now() / 1000);
  R.setAuth('jwt.expired', { bearer: signJwt({ ...claims, iat: now - 7200, exp: now - 3600 }, R.appSecret) });
  R.setAuth('jwt.badSignature', { bearer: signJwt({ ...claims, iat: now, exp: now + 3600 }, 'pas-le-bon-secret') });
  R.setAuth('jwt.garbage', { header: 'Bearer pas-un-jwt' });
  await R.req('auth.jwt.expired', { as: 'jwt.expired', path: '/v2/lrs/count' });
  await R.req('auth.jwt.badSignature', { as: 'jwt.badSignature', path: '/v2/lrs/count' });
  await R.req('auth.jwt.garbage', { as: 'jwt.garbage', path: '/v2/lrs/count' });
  await R.req('auth.jwt.queryParam', { path: '/v2/lrs/count', query: { access_token: orgLogin.body } });

  // Clients API (Basic)
  for (const [key, c] of Object.entries(m.clients)) R.setAuth(`client.${key}`, { basic: `${c.key}:${c.secret}` });
  R.setAuth('client.bad', { basic: `${m.clients.main.key}:mauvais-secret` });
  for (const key of [...Object.keys(m.clients), 'bad']) {
    await R.req(`auth.clientInfo.${key}`, { as: `client.${key}`, path: '/auth/client/info' });
  }

  // OAuth2 client_credentials
  const oauth = await R.req('auth.oauth2.ok', { method: 'POST', path: '/oauth2/token', json: { grant_type: 'client_credentials', client_id: m.clients.main.key, client_secret: m.clients.main.secret } });
  R.setAuth('oauth', { bearer: oauth.body.access_token });
  await R.req('auth.oauth2.form', { method: 'POST', path: '/oauth2/token', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: m.clients.read.key, client_secret: m.clients.read.secret }) });
  await R.req('auth.oauth2.badSecret', { method: 'POST', path: '/oauth2/token', json: { grant_type: 'client_credentials', client_id: m.clients.main.key, client_secret: 'faux' } });
  await R.req('auth.oauth2.badGrant', { method: 'POST', path: '/oauth2/token', json: { grant_type: 'password', client_id: m.clients.main.key, client_secret: m.clients.main.secret } });
  await R.req('auth.oauth2.empty', { method: 'POST', path: '/oauth2/token', json: {} });
  await R.req('auth.oauth2.disabledClient', { method: 'POST', path: '/oauth2/token', json: { grant_type: 'client_credentials', client_id: m.clients.disabled.key, client_secret: m.clients.disabled.secret } });

  // Réinitialisation du mot de passe (le mailer est factice : TESTING=true)
  await R.req('auth.reset.requestKnown', { method: 'POST', path: '/auth/resetpassword/request', json: { email: m.users.observateur.email } });
  await R.req('auth.reset.requestUnknown', { method: 'POST', path: '/auth/resetpassword/request', json: { email: 'inconnu@profenpoche.test' } });
  await R.req('auth.reset.noPassword', { method: 'POST', path: '/auth/resetpassword/reset', json: { email: m.users.observateur.email, token: 'x' } });
  await R.req('auth.reset.badToken', { method: 'POST', path: '/auth/resetpassword/reset', json: { email: m.users.observateur.email, token: 'jeton-invalide', password: 'Nouveau-Mot-2026' } });

  // -------------------------------------------------------------------------
  // 2. Modèles REST (express-restify-mongoose) et connexions Relay, en tant qu'organisation
  const models = ['organisation', 'lrs', 'client', 'user', 'role', 'visualisation', 'dashboard', 'query', 'export', 'download',
    'statementforwarding', 'personasimport', 'personaattribute', 'querybuildercache', 'querybuildercachevalue', 'batchdelete',
    'sitesettings', 'statement', 'importcsv'];
  const firstIds = {};
  for (const model of models) {
    const list = await R.req(`rest.${model}.list`, { as: 'org', path: `/v2/${model}`, query: { sort: { _id: 1 }, limit: 3 } });
    await R.req(`rest.${model}.count`, { as: 'org', path: `/v2/${model}/count` });
    const first = Array.isArray(list.body) ? list.body[0]?._id : undefined;
    firstIds[model] = first;
    if (first) {
      await R.req(`rest.${model}.get`, { as: 'org', path: `/v2/${model}/${first}` });
      if (model === 'lrs' || model === 'visualisation') {
        // Toutes les routes /shallow restent sans réponse en legacy : 2 cas suffisent.
        await R.req(`rest.${model}.shallow`, { as: 'org', path: `/v2/${model}/${first}/shallow`, timeout: 5000 });
      }
    }
    const page1 = await R.req(`connection.${model}.page1`, { as: 'org', path: `/connection/${model}`, query: { first: 2, sort: { _id: 1 } } });
    const cursor = page1.body?.pageInfo?.endCursor;
    if (cursor) await R.req(`connection.${model}.page2`, { as: 'org', path: `/connection/${model}`, query: { first: 2, sort: { _id: 1 }, after: cursor } });
    await R.req(`indexes.${model}`, { as: 'org', path: `/indexes/${model}`, unordered: [''] });
  }
  await R.req('rest.stream.list', { as: 'org', path: '/v2/stream' });
  await R.req('rest.personasimporttemplate.list', { as: 'org', path: '/v2/personasimporttemplate' });
  await R.req('rest.lrs.getUnknown', { as: 'org', path: '/v2/lrs/5f0000000000000000000000' });
  await R.req('rest.lrs.getInvalidId', { as: 'org', path: '/v2/lrs/pas-un-id' });

  // Paramètres erm : query ($oid, $dte), select, skip, distinct, populate, tri multiple
  await R.req('rest.query.oid', { as: 'org', path: '/v2/client', query: { query: { lrs_id: { $oid: lrsMain } }, sort: { _id: 1 }, select: { title: 1, scopes: 1 } } });
  await R.req('rest.query.dte', { as: 'org', path: '/v2/visualisation/count', query: { query: { createdAt: { $gte: { $dte: daysAgo(1) } } } } });
  await R.req('rest.query.skip', { as: 'org', path: '/v2/visualisation', query: { sort: { description: 1, _id: 1 }, skip: 5, limit: 3, select: { description: 1, type: 1 } } });
  await R.req('rest.query.distinct', { as: 'org', path: '/v2/visualisation', query: { distinct: 'type' } });
  await R.req('rest.query.populate', { as: 'org', path: `/v2/dashboard/${m.dashboards.public}`, query: { populate: 'owner' } });
  await R.req('rest.query.regex', { as: 'org', path: '/v2/visualisation', query: { query: { description: { $regex: 'Score', $options: 'i' } }, sort: { _id: 1 }, select: { description: 1 } } });
  await R.req('rest.query.invalidJson', { as: 'org', path: '/v2/visualisation', query: { query: '{pas du json' } });
  await R.req('connection.statement.filterSort', { as: 'org', path: '/connection/statement', query: { filter: { 'statement.verb.id': verb('passed') }, sort: { timestamp: -1, _id: 1 }, first: 3, project: { 'statement.id': 1, timestamp: 1 } } });
  await R.req('connection.statement.last', { as: 'org', path: '/connection/statement', query: { sort: { _id: 1 }, last: 2, project: { 'statement.id': 1 } } });
  await R.req('connection.statement.hint', { as: 'org', path: '/connection/statement', query: { sort: { _id: 1 }, first: 1, hint: { _id: 1 }, project: { 'statement.id': 1 } } });
  await R.req('connection.statement.badCursor', { as: 'org', path: '/connection/statement', query: { first: 1, after: 'curseur-invalide' } });

  // Documents de l'instantané utiles aux cas suivants
  const one = async (filter, sort = { _id: 1 }) => (await R.req(`fixture.statement.${Object.keys(filter).join('+')}`, { as: 'org', path: '/connection/statement', query: { filter, sort, first: 1 } })).body.edges[0]?.node;
  const stPassed = await one({ 'statement.verb.id': verb('passed') });
  const stVoided = await one({ voided: true });
  const stAttachment = await one({ 'statement.attachments.0': { $exists: true } });
  const stGroup = await one({ 'statement.actor.objectType': 'Group' });
  const stSub = await one({ 'statement.object.objectType': 'SubStatement' });
  const stSecond = await one({ lrs_id: { $oid: lrsSecond } });

  // -------------------------------------------------------------------------
  // 3. Matrice des droits : chaque profil sur un ensemble de routes de lecture
  const profiles = ['admin', 'org', 'analyste', 'observateur', 'referent', 'filtre', 'client.main', 'client.read', 'client.api',
    'client.second', 'client.disabled', 'client.state', 'client.bad', 'jwt.expired', 'anon'];
  const probes = [
    ['lrs', '/v2/lrs/count'], ['client', '/v2/client/count'], ['user', '/v2/user/count'], ['role', '/v2/role/count'],
    ['organisation', '/v2/organisation/count'], ['visualisation', '/v2/visualisation/count'], ['dashboard', '/v2/dashboard/count'],
    ['statementforwarding', '/v2/statementforwarding/count'], ['personaattribute', '/v2/personaattribute/count'],
    ['export', '/v2/export/count'], ['query', '/v2/query/count'], ['sitesettings', '/v2/sitesettings/count'],
    ['statementCount', '/statements/count'], ['persona', '/v2/persona/count'],
  ];
  for (const as of profiles) {
    for (const [name, path] of probes) await R.req(`scope.${as}.${name}`, { as, path });
    await R.req(`scope.${as}.statementPage`, { as, path: '/connection/statement', query: { first: 2, sort: { _id: 1 }, project: { 'statement.id': 1, lrs_id: 1, 'statement.context.platform': 1 } } });
  }

  // -------------------------------------------------------------------------
  // 4. Statements : comptages et agrégations
  await R.req('statements.count.all', { as: 'org', path: '/statements/count' });
  await R.req('statements.count.verb', { as: 'org', path: '/statements/count', query: { filter: { 'statement.verb.id': verb('completed') } } });
  await R.req('statements.count.query', { as: 'org', path: '/statements/count', query: { query: { 'statement.verb.id': verb('failed') } } });
  await R.req('statements.count.dte', { as: 'org', path: '/statements/count', query: { filter: { timestamp: { $gte: { $dte: daysAgo(30) } } } } });
  await R.req('statements.count.oid', { as: 'org', path: '/statements/count', query: { filter: { lrs_id: { $oid: lrsSecond } } } });
  await R.req('statements.count.extension', { as: 'org', path: '/statements/count', query: { filter: { 'statement.context.extensions.https://profenpoche&46;test/xapi/extensions/appareil': { $exists: true } } } });
  await R.req('statements.count.personaIdent', { as: 'org', path: '/statements/count', query: { filter: { 'person._id': { $personaIdent: { key: 'persona.import.classe', value: '4eA' } } } } });
  await R.req('statements.count.badFilter', { as: 'org', path: '/statements/count', query: { filter: '{oups' } });

  const agg = (id, pipeline, extra = {}, as = 'org') => R.req(id, { as, path: '/statements/aggregate', query: { pipeline, cache: false, ...extra } });
  await agg('statements.aggregate.byVerb', [{ $group: { _id: '$statement.verb.id', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]);
  await agg('statements.aggregate.byPlatform', [{ $match: { 'statement.context.platform': { $exists: true } } }, { $group: { _id: '$statement.context.platform', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  await agg('statements.aggregate.dotKeys', [{ $match: { 'statement.context.extensions.https://profenpoche&46;test/xapi/extensions/appareil': { $exists: true } } }, { $sort: { _id: 1 } }, { $limit: 2 }, { $project: { 'statement.context.extensions': 1 } }]);
  await agg('statements.aggregate.limitSkip', [{ $sort: { _id: 1 } }, { $project: { 'statement.id': 1 } }], { limit: 3, skip: 10 });
  await agg('statements.aggregate.dte', [{ $match: { timestamp: { $gte: { $dte: daysAgo(7) } } } }, { $count: 'n' }]);
  await agg('statements.aggregate.oid', [{ $match: { lrs_id: { $oid: lrsMain } } }, { $count: 'n' }]);
  await agg('statements.aggregate.lookupPipeline', [{ $sort: { _id: 1 } }, { $limit: 2 }, { $lookup: { from: 'personas', let: { pid: '$person._id' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$pid'] } } }, { $project: { name: 1 } }], as: 'p' } }, { $project: { 'p.name': 1 } }]);
  await agg('statements.aggregate.lookupLocalField', [{ $sort: { _id: 1 } }, { $limit: 2 }, { $lookup: { from: 'personas', localField: 'person._id', foreignField: '_id', as: 'p' } }, { $project: { 'p.name': 1 } }]);
  await agg('statements.aggregate.lookupForbidden', [{ $sort: { _id: 1 } }, { $limit: 1 }, { $lookup: { from: 'users', localField: 'organisation', foreignField: 'organisations', as: 'u' } }, { $project: { 'u.email': 1 } }]);
  await agg('statements.aggregate.out', [{ $sort: { _id: 1 } }, { $limit: 1 }, { $project: { _id: 1 } }, { $out: 'golden_out' }]);
  await agg('statements.aggregate.byFilteredUser', [{ $group: { _id: '$statement.context.platform', n: { $sum: 1 } } }, { $sort: { _id: 1 } }], {}, 'filtre');
  await agg('statements.aggregate.byClientSecond', [{ $count: 'n' }], {}, 'client.second');
  await agg('statements.aggregate.byClientRead', [{ $count: 'n' }], {}, 'client.read');
  await R.req('statements.aggregate.noPipeline', { as: 'org', path: '/statements/aggregate' });
  await R.req('statements.aggregate.badPipeline', { as: 'org', path: '/statements/aggregate', query: { pipeline: '[{oups' } });
  await R.req('statements.aggregate.v1', { as: 'org', path: '/v1/statements/aggregate', query: { pipeline: [{ $match: { 'statement.verb.id': verb('passed') } }, { $count: 'n' }] } });
  // Route utilisée par le front pour chaque pipeline : on attend le résultat calculé.
  // Le résultat est trié de façon canonique (ordre arbitraire des ex-aequo) ; pour un compteur,
  // « value » est un $first sans tri, donc une personne arbitraire.
  const aggAsync = (id, pipeline, { as = 'org', counter = false } = {}) => R.req(id, {
    as, path: '/statements/aggregateAsync', query: { pipeline },
    unordered: ['/result'], mask: counter ? ['/result/*/value'] : [],
    poll: { until: ({ body }) => body?.result != null && body?.status?.isRunning === false, every: 500, max: 120 },
  });
  await aggAsync('statements.aggregateAsync.byVerb', [{ $group: { _id: '$statement.verb.id', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);

  // Pipelines du front pour chaque visualisation (date figée = date de référence du jeu de test)
  for (const [key, vizId] of Object.entries(m.visualisations)) {
    const viz = await R.req(`viz.${key}.get`, { as: 'org', path: `/v2/visualisation/${vizId}` });
    const pipelines = await R.frontPipelines(`viz.${key}`, { visualisation: viz.body, orgTimezone: 'Europe/Paris', now: m.referenceDate });
    const counter = viz.body.type === 'COUNTER';
    for (const [i, pipeline] of pipelines.flat(1).entries()) await aggAsync(`viz.${key}.aggregate.${i}`, pipeline, { counter });
  }
  // Mêmes pipelines avec le filtre d'un partage de dashboard (mode ANY)
  const shareAny = (await R.req('dashboard.custom.get', { as: 'org', path: `/v2/dashboard/${m.dashboards.custom}` })).body.shareable.find((s) => s.filterMode === 'ANY');
  for (const key of ['barScore', 'compteur', 'pieVerbes']) {
    const viz = await R.req(`viz.${key}.getForShare`, { as: 'org', path: `/v2/visualisation/${m.visualisations[key]}` });
    const pipelines = await R.frontPipelines(`viz.${key}.shareAny`, { visualisation: viz.body, dashboardFilter: JSON.parse(shareAny.filter), orgTimezone: 'Europe/Paris', now: m.referenceDate });
    for (const [i, pipeline] of pipelines.flat(1).entries()) await aggAsync(`viz.${key}.shareAny.aggregate.${i}`, pipeline, { counter: viz.body.type === 'COUNTER' });
  }

  // -------------------------------------------------------------------------
  // 5. Dashboards partagés (rendu serveur du front, jeton dashboard)
  const custom = (await R.req('dashboard.custom.getAgain', { as: 'org', path: `/v2/dashboard/${m.dashboards.custom}` })).body;
  const dashTokens = {};
  for (const [i, share] of custom.shareable.entries()) {
    const r = await R.req(`dashboard.ssr.share${i}`, { ui: true, path: `/dashboards/${custom._id}/${share._id}`, mode: 'html' });
    const token = r.buf.toString('utf8').match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0];
    if (token) dashTokens[i] = token;
  }
  await R.req('dashboard.ssr.validDomainReferer', { ui: true, path: `/dashboards/${custom._id}/${custom.shareable[3]._id}`, headers: { Referer: 'https://ecole.profenpoche.test/page' }, mode: 'html' });
  await R.req('dashboard.ssr.invalidDomainReferer', { ui: true, path: `/dashboards/${custom._id}/${custom.shareable[3]._id}`, headers: { Referer: 'https://ailleurs.example/page' }, mode: 'html' });
  await R.req('dashboard.ssr.legacyLink', { ui: true, path: `/dashboards/${custom._id}`, mode: 'html' });
  await R.req('dashboard.ssr.notShared', { ui: true, path: `/dashboards/${m.dashboards.blank}`, mode: 'html' });
  await R.req('dashboard.ssr.unknown', { ui: true, path: '/dashboards/5f0000000000000000000000', mode: 'html' });

  if (dashTokens[1]) {
    R.setAuth('dashboard', { bearer: dashTokens[1] });
    await R.req('dashboard.token.getDashboard', { as: 'dashboard', path: `/v2/dashboard/${custom._id}` });
    await R.req('dashboard.token.otherDashboard', { as: 'dashboard', path: `/v2/dashboard/${m.dashboards.public}` });
    await R.req('dashboard.token.visualisations', { as: 'dashboard', path: '/v2/visualisation', query: { sort: { _id: 1 }, select: { description: 1 } } });
    await R.req('dashboard.token.lrs', { as: 'dashboard', path: '/v2/lrs/count' });
    await agg('dashboard.token.foreignPipeline', [{ $count: 'n' }], {}, 'dashboard');
    // Pipeline exact du front, calculé à l'instant présent (vérification serveur checkDashboardAuth) :
    // seul le statut est comparé, le résultat dépend de la date du jour.
    const viz = await R.req('dashboard.token.vizForPipeline', { as: 'org', path: `/v2/visualisation/${m.visualisations.compteur}` });
    const live = await R.frontPipelines('dashboard.live', { visualisation: viz.body, dashboardFilter: {}, orgTimezone: 'Europe/Paris', live: true });
    if (live) await R.req('dashboard.token.frontPipeline', { as: 'dashboard', path: '/statements/aggregate', query: { pipeline: live.flat(1)[0] }, mode: 'status' });
  }

  // -------------------------------------------------------------------------
  // 6. Personas
  await R.req('persona.count', { as: 'org', path: '/v2/persona/count' });
  await R.req('persona.countQuery', { as: 'org', path: '/v2/persona/count', query: { query: { name: { $regex: '^A' } } } });
  const personas = await R.req('persona.list', { as: 'org', path: '/v2/persona', query: { sort: { name: 1, _id: 1 }, limit: 5 } });
  await R.req('persona.listSkip', { as: 'org', path: '/v2/persona', query: { sort: { name: 1, _id: 1 }, limit: 5, skip: 5 } });
  const personaId = personas.body[0]?._id;
  await R.req('persona.get', { as: 'org', path: `/v2/persona/${personaId}` });
  await R.req('persona.getUnknown', { as: 'org', path: '/v2/persona/5f0000000000000000000000' });
  const pc = await R.req('persona.connection.page1', { as: 'org', path: '/connection/persona', query: { first: 3, sort: { name: 1, _id: 1 } } });
  if (pc.body?.pageInfo?.endCursor) await R.req('persona.connection.page2', { as: 'org', path: '/connection/persona', query: { first: 3, sort: { name: 1, _id: 1 }, after: pc.body.pageInfo.endCursor } });
  await R.req('persona.connection.filter', { as: 'org', path: '/connection/persona', query: { first: 3, filter: { name: { $regex: 'Martin' } }, sort: { _id: 1 } } });
  await R.req('personaIdentifier.count', { as: 'org', path: '/v2/personaIdentifier/count' });
  const pis = await R.req('personaIdentifier.list', { as: 'org', path: '/v2/personaIdentifier', query: { sort: { _id: 1 }, limit: 5 } });
  await R.req('personaIdentifier.byPersona', { as: 'org', path: '/v2/personaIdentifier', query: { filter: { persona: personaId } } });
  await R.req('personaIdentifier.get', { as: 'org', path: `/v2/personaIdentifier/${pis.body[0]?._id}` });
  await R.req('personaIdentifier.connection', { as: 'org', path: '/connection/personaidentifier', query: { first: 3, sort: { _id: 1 } } });
  await R.req('personaIdentifier.connectionByPersona', { as: 'org', path: '/connection/personaidentifier', query: { first: 3, filter: { persona: personaId } } });
  await R.req('personaAttribute.list', { as: 'org', path: '/v2/personaattribute', query: { sort: { key: 1, _id: 1 }, limit: 5 } });
  await R.req('personaAttribute.byPersona', { as: 'org', path: '/v2/personaattribute', query: { query: { personaId: { $oid: personaId } }, sort: { key: 1 } } });
  await R.req('persona.importErrors', { as: 'org', path: `/organisation/${orgId}/importpersonaserror/${m.personasImport}.csv` });
  await R.req('persona.asReferent', { as: 'referent', path: '/v2/persona/count' });
  await R.req('persona.asObservateur', { as: 'observateur', path: '/v2/persona/count' });

  // -------------------------------------------------------------------------
  // 7. Téléchargements
  await R.req('download.logo', { as: 'admin', path: `/downloadlogo/${orgId}`, mode: 'hash' });
  await R.req('download.logoUnknownOrg', { as: 'admin', path: '/downloadlogo/5f0000000000000000000000', mode: 'status' });
  // Export complet du jeu de test (~40 Mo) : fichier stocké, servi tel quel → empreinte.
  await R.req('download.exportCsv', { as: 'org', path: `/organisation/${orgId}/downloadexport/${m.export.download}.csv`, mode: 'hash' });
  await R.req('download.exportCsvCookie', { path: `/organisation/${orgId}/downloadexport/${m.export.download}.csv`, headers: { Cookie: `access_token_organisation_${orgId}=${orgLogin.body}` }, mode: 'hash' });
  await R.req('download.exportUnknown', { as: 'org', path: `/organisation/${orgId}/downloadexport/5f0000000000000000000000.csv` });

  // -------------------------------------------------------------------------
  // 8. Service xAPI : lectures
  const xget = (id, path, query, as = 'client.main', extra = {}) => R.req(id, { as, xapi: true, path, query, ...extra });
  await R.req('xapi.about', { xapi: true, path: '/about', version: false });
  await xget('xapi.statements.byId', '/statements', { statementId: stPassed.statement.id });
  await xget('xapi.statements.byIdIds', '/statements', { statementId: stPassed.statement.id, format: 'ids' });
  await xget('xapi.statements.byIdCanonical', '/statements', { statementId: stPassed.statement.id, format: 'canonical' }, 'client.main', { headers: { 'Accept-Language': 'fr-FR' } });
  await xget('xapi.statements.voidedById', '/statements', { statementId: stVoided.statement.id });
  await xget('xapi.statements.voidedStatementId', '/statements', { voidedStatementId: stVoided.statement.id });
  await xget('xapi.statements.unknownId', '/statements', { statementId: '00000000-0000-4000-8000-000000000000' });
  await xget('xapi.statements.bothIds', '/statements', { statementId: stPassed.statement.id, voidedStatementId: stVoided.statement.id });
  await xget('xapi.statements.group', '/statements', { statementId: stGroup.statement.id });
  await xget('xapi.statements.subStatement', '/statements', { statementId: stSub.statement.id });
  await xget('xapi.statements.attachmentsFalse', '/statements', { statementId: stAttachment.statement.id });
  await xget('xapi.statements.attachmentsTrue', '/statements', { statementId: stAttachment.statement.id, attachments: 'true' });
  const page = await xget('xapi.statements.page1', '/statements', { limit: '5' });
  if (page.body?.more) await R.req('xapi.statements.more', { as: 'client.main', path: page.body.more, ui: true, headers: { 'X-Experience-API-Version': '1.0.3' } });
  await xget('xapi.statements.ascending', '/statements', { limit: '3', ascending: 'true' });
  await xget('xapi.statements.agentMbox', '/statements', { agent: JSON.stringify({ mbox: learner.mbox }), limit: '3' });
  await xget('xapi.statements.agentAccount', '/statements', { agent: JSON.stringify({ account: accountLearner.account }), limit: '3' });
  await xget('xapi.statements.verb', '/statements', { verb: verb('failed'), limit: '3' });
  await xget('xapi.statements.activity', '/statements', { activity: course, limit: '3' });
  await xget('xapi.statements.relatedActivities', '/statements', { activity: world.programme.id, related_activities: 'true', limit: '3' });
  await xget('xapi.statements.relatedAgents', '/statements', { agent: JSON.stringify({ mbox: world.learners[1].actor.mbox }), related_agents: 'true', limit: '3' });
  await xget('xapi.statements.sinceUntil', '/statements', { since: daysAgo(10), until: daysAgo(9), limit: '3' });
  await xget('xapi.statements.formatExact', '/statements', { verb: verb('answered'), limit: '2', format: 'exact' });
  await xget('xapi.statements.formatIds', '/statements', { verb: verb('answered'), limit: '2', format: 'ids' });
  await xget('xapi.statements.registration', '/statements', { registration: stPassed.statement.context?.registration ?? '00000000-0000-4000-8000-000000000001', limit: '3' });
  await xget('xapi.statements.badAgent', '/statements', { agent: '{pas-du-json' });
  await xget('xapi.statements.badLimit', '/statements', { limit: '-4' });
  await xget('xapi.statements.secondStore', '/statements', { statementId: stSecond.statement.id }, 'client.second');
  await xget('xapi.statements.otherStore', '/statements', { statementId: stSecond.statement.id }, 'client.main');
  await xget('xapi.statements.readClient', '/statements', { limit: '2' }, 'client.read');
  await xget('xapi.statements.mineClient', '/statements', { limit: '2' }, 'client.mine');
  await xget('xapi.statements.stateClient', '/statements', { limit: '2' }, 'client.state');
  await xget('xapi.statements.disabledClient', '/statements', { limit: '2' }, 'client.disabled');
  await xget('xapi.statements.badAuth', '/statements', { limit: '2' }, 'client.bad');
  await xget('xapi.statements.noAuth', '/statements', { limit: '2' }, 'anon');
  await xget('xapi.statements.oauth', '/statements', { limit: '2' }, 'oauth');
  await R.req('xapi.statements.noVersion', { as: 'client.main', xapi: true, path: '/statements', query: { limit: '1' }, version: false });
  await R.req('xapi.statements.badVersion', { as: 'client.main', xapi: true, path: '/statements', query: { limit: '1' }, headers: { 'X-Experience-API-Version': '0.9' } });

  const agentQ = JSON.stringify(learner);
  await xget('xapi.state.json', '/activities/state', { activityId: course, agent: agentQ, stateId: 'progression', registration: createRng(m.seed + 7).uuid() }, 'client.state');
  await xget('xapi.state.binary', '/activities/state', { activityId: course, agent: agentQ, stateId: 'capture' }, 'client.state', { mode: 'hash' });
  await xget('xapi.state.ids', '/activities/state', { activityId: course, agent: agentQ }, 'client.state');
  await xget('xapi.state.idsSince', '/activities/state', { activityId: course, agent: agentQ, since: daysAgo(1) }, 'client.state');
  await xget('xapi.state.unknown', '/activities/state', { activityId: course, agent: agentQ, stateId: 'inexistant' }, 'client.state');
  await xget('xapi.state.missingAgent', '/activities/state', { activityId: course, stateId: 'progression' }, 'client.state');
  await xget('xapi.state.wrongScope', '/activities/state', { activityId: course, agent: agentQ, stateId: 'progression' }, 'client.read');
  await xget('xapi.activityProfile.get', '/activities/profile', { activityId: course, profileId: 'configuration' }, 'client.state');
  await xget('xapi.activityProfile.ids', '/activities/profile', { activityId: course }, 'client.state');
  await xget('xapi.agentProfile.json', '/agents/profile', { agent: agentQ, profileId: 'preferences' }, 'client.state');
  await xget('xapi.agentProfile.text', '/agents/profile', { agent: agentQ, profileId: 'notes.txt' }, 'client.state');
  await xget('xapi.agentProfile.ids', '/agents/profile', { agent: agentQ }, 'client.state');
  await xget('xapi.activities.full', '/activities', { activityId: course });
  await xget('xapi.activities.interaction', '/activities', { activityId: world.interactions[0].object.id });
  await xget('xapi.activities.unknown', '/activities', { activityId: 'https://profenpoche.test/inconnue' });
  await xget('xapi.agents.person', '/agents', { agent: agentQ });
  await xget('xapi.agents.account', '/agents', { agent: JSON.stringify(accountLearner) });

  // =========================================================================
  // ÉCRITURES (l'état diverge de l'instantané à partir d'ici)
  // =========================================================================

  // 9. xAPI : écritures (identifiants fournis pour rester déterministes)
  const sid = (n) => `9a1d0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const base = { actor: learner, verb: { id: verb('experienced'), display: { 'fr-FR': 'a consulté' } }, object: { objectType: 'Activity', id: course }, timestamp: daysAgo(0.5) };
  await R.req('xapi.write.postOne', { as: 'client.main', xapi: true, method: 'POST', path: '/statements', json: { ...base, id: sid(1) } });
  await R.req('xapi.write.postMany', { as: 'client.main', xapi: true, method: 'POST', path: '/statements', json: [{ ...base, id: sid(2) }, { ...base, id: sid(3), verb: { id: verb('completed') } }] });
  await R.req('xapi.write.put', { as: 'client.main', xapi: true, method: 'PUT', path: '/statements', query: { statementId: sid(4) }, json: { ...base, id: sid(4) } });
  await R.req('xapi.write.putSameAgain', { as: 'client.main', xapi: true, method: 'PUT', path: '/statements', query: { statementId: sid(4) }, json: { ...base, id: sid(4) } });
  await R.req('xapi.write.putConflict', { as: 'client.main', xapi: true, method: 'PUT', path: '/statements', query: { statementId: sid(4) }, json: { ...base, id: sid(4), verb: { id: verb('failed') } } });
  await R.req('xapi.write.putNoId', { as: 'client.main', xapi: true, method: 'PUT', path: '/statements', json: { ...base } });
  await R.req('xapi.write.invalid', { as: 'client.main', xapi: true, method: 'POST', path: '/statements', json: { actor: { name: 'sans IFI' }, verb: { id: 'pas-une-iri' }, object: {} } });
  await R.req('xapi.write.void', { as: 'client.main', xapi: true, method: 'POST', path: '/statements', json: { id: sid(5), actor: world.teachers[0].actor, verb: { id: verb('voided') }, object: { objectType: 'StatementRef', id: sid(1) } } });
  await R.req('xapi.write.voidVoiding', { as: 'client.main', xapi: true, method: 'POST', path: '/statements', json: { id: sid(6), actor: world.teachers[0].actor, verb: { id: verb('voided') }, object: { objectType: 'StatementRef', id: sid(5) } } });
  await R.req('xapi.write.readOnlyClient', { as: 'client.read', xapi: true, method: 'POST', path: '/statements', json: { ...base, id: sid(7) } });
  await R.req('xapi.write.disabledClient', { as: 'client.disabled', xapi: true, method: 'POST', path: '/statements', json: { ...base, id: sid(8) } });
  await R.req('xapi.write.mineClient', { as: 'client.mine', xapi: true, method: 'POST', path: '/statements', json: { ...base, id: sid(9) } });
  await R.req('xapi.write.oauth', { as: 'oauth', xapi: true, method: 'POST', path: '/statements', json: { ...base, id: sid(10) } });
  await R.req('xapi.write.priorityLow', { as: 'client.main', xapi: true, method: 'POST', path: '/statements', query: { priority: 'LOW' }, json: { ...base, id: sid(11) } });
  await R.req('xapi.write.readBack', { as: 'client.main', xapi: true, path: '/statements', query: { statementId: sid(2) } });
  await R.req('xapi.write.readVoided', { as: 'client.main', xapi: true, path: '/statements', query: { voidedStatementId: sid(1) } });
  await R.req('xapi.write.readMineOwn', { as: 'client.mine', xapi: true, path: '/statements', query: { statementId: sid(9) } });
  await R.req('xapi.write.readMineOther', { as: 'client.mine', xapi: true, path: '/statements', query: { statementId: sid(2) } });

  const sq = { activityId: course, agent: agentQ, stateId: 'golden' };
  await R.req('xapi.state.put', { as: 'client.state', xapi: true, method: 'PUT', path: '/activities/state', query: sq, json: { a: 1 } });
  await R.req('xapi.state.postMerge', { as: 'client.state', xapi: true, method: 'POST', path: '/activities/state', query: sq, json: { b: 2 } });
  await R.req('xapi.state.getMerged', { as: 'client.state', xapi: true, path: '/activities/state', query: sq });
  await R.req('xapi.state.postNonJson', { as: 'client.state', xapi: true, method: 'POST', path: '/activities/state', query: sq, body: 'texte', headers: { 'Content-Type': 'text/plain' } });
  await R.req('xapi.state.delete', { as: 'client.state', xapi: true, method: 'DELETE', path: '/activities/state', query: sq });
  await R.req('xapi.state.getDeleted', { as: 'client.state', xapi: true, path: '/activities/state', query: sq });
  await R.req('xapi.state.deleteAll', { as: 'client.state', xapi: true, method: 'DELETE', path: '/activities/state', query: { activityId: course, agent: JSON.stringify(world.learners[2].actor) } });
  const pq = { activityId: course, profileId: 'golden' };
  await R.req('xapi.activityProfile.putNew', { as: 'client.state', xapi: true, method: 'PUT', path: '/activities/profile', query: pq, json: { v: 1 }, headers: { 'If-None-Match': '*' } });
  await R.req('xapi.activityProfile.putExistsNoneMatch', { as: 'client.state', xapi: true, method: 'PUT', path: '/activities/profile', query: pq, json: { v: 2 }, headers: { 'If-None-Match': '*' } });
  await R.req('xapi.activityProfile.putNoPrecondition', { as: 'client.state', xapi: true, method: 'PUT', path: '/activities/profile', query: pq, json: { v: 3 } });
  await R.req('xapi.activityProfile.putBadIfMatch', { as: 'client.state', xapi: true, method: 'PUT', path: '/activities/profile', query: pq, json: { v: 4 }, headers: { 'If-Match': '"faux"' } });
  const cur = await R.req('xapi.activityProfile.getForEtag', { as: 'client.state', xapi: true, path: '/activities/profile', query: pq });
  await R.req('xapi.activityProfile.putGoodIfMatch', { as: 'client.state', xapi: true, method: 'PUT', path: '/activities/profile', query: pq, json: { v: 5 }, headers: { 'If-Match': cur.headers.get('etag') ?? '"?"' } });
  await R.req('xapi.activityProfile.delete', { as: 'client.state', xapi: true, method: 'DELETE', path: '/activities/profile', query: pq });
  await R.req('xapi.agentProfile.post', { as: 'client.state', xapi: true, method: 'POST', path: '/agents/profile', query: { agent: agentQ, profileId: 'golden' }, json: { x: 1 } });
  await R.req('xapi.agentProfile.delete', { as: 'client.state', xapi: true, method: 'DELETE', path: '/agents/profile', query: { agent: agentQ, profileId: 'golden' } });

  // 10. Métadonnées de statement et suppressions
  await R.req('statements.metadata.patch', { as: 'client.main', method: 'PATCH', path: `/v2/statementmetadata/${stPassed._id}`, json: { 'https://profenpoche.test/meta.golden': { ok: true } } });
  await R.req('statements.metadata.post', { as: 'client.main', method: 'POST', path: `/v2/statementmetadata/${stPassed._id}`, json: { 'https://profenpoche.test/meta.remplace': 1 } });
  await R.req('statements.metadata.scopeAll', { as: 'client.api', method: 'PATCH', path: `/v2/statementmetadata/${stPassed._id}`, json: { a: 1 } });
  await R.req('statements.metadata.unknown', { as: 'client.main', method: 'PATCH', path: '/v2/statementmetadata/5f0000000000000000000000', json: { a: 1 } });
  await R.req('statements.rest.create', { as: 'org', method: 'POST', path: '/v2/statement', json: { statement: {} } });
  await R.req('statements.rest.update', { as: 'org', method: 'PATCH', path: `/v2/statement/${stPassed._id}`, json: { voided: true } });
  await R.req('statements.rest.deleteBulk', { as: 'org', method: 'DELETE', path: '/v2/statement' });
  await R.req('statements.rest.deleteOne', { as: 'org', method: 'DELETE', path: `/v2/statement/${stGroup._id}` });
  await R.req('statements.batchDelete.emptyFilter', { as: 'client.main', method: 'POST', path: '/v2/batchdelete/initialise', json: { filter: {} } });
  await R.req('statements.batchDelete.noScope', { as: 'client.read', method: 'POST', path: '/v2/batchdelete/initialise', json: { filter: { 'statement.verb.id': verb('shared') } } });
  await R.req('statements.batchDelete.terminateUnknown', { as: 'client.main', method: 'POST', path: '/v2/batchdelete/terminate/5f0000000000000000000000' });
  await R.req('statements.batchDelete.terminateAll', { as: 'client.main', method: 'POST', path: '/v2/batchdelete/terminate/all' });
  await R.req('statements.batchDelete.restCreate', { as: 'org', method: 'POST', path: '/v2/batchdelete', json: { filter: '{}' } });

  // 11. Administration : création, modification, suppression de chaque type de document
  const lrs = await R.req('admin.lrs.create', { as: 'org', method: 'POST', path: '/v2/lrs', json: { title: 'LRS golden', description: 'créé par le scénario' } });
  await R.req('admin.lrs.createInvalid', { as: 'org', method: 'POST', path: '/v2/lrs', json: { description: 'sans titre' } });
  await R.req('admin.lrs.update', { as: 'org', method: 'POST', path: `/v2/lrs/${lrs.body._id}`, json: { title: 'LRS golden renommé' } });
  await R.req('admin.lrs.patch', { as: 'org', method: 'PATCH', path: `/v2/lrs/${lrs.body._id}`, json: { description: 'modifié' } });
  await R.req('admin.lrs.autoClient', { as: 'org', path: '/v2/client', query: { query: { lrs_id: { $oid: lrs.body._id } }, select: { title: 1, scopes: 1, lrs_id: 1 } } });
  await R.req('admin.lrs.createAsAnalyste', { as: 'analyste', method: 'POST', path: '/v2/lrs', json: { title: 'interdit' } });

  const client = await R.req('admin.client.create', { as: 'org', method: 'POST', path: '/v2/client', json: { title: 'Client golden', lrs_id: lrs.body._id, scopes: ['statements/read'] } });
  await R.req('admin.client.update', { as: 'org', method: 'PATCH', path: `/v2/client/${client.body._id}`, json: { scopes: ['xapi/all'], isTrusted: false } });
  await R.req('admin.client.badScope', { as: 'org', method: 'PATCH', path: `/v2/client/${client.body._id}`, json: { scopes: ['scope/inexistant'] } });
  await R.req('admin.client.delete', { as: 'org', method: 'DELETE', path: `/v2/client/${client.body._id}` });
  await R.req('admin.client.deleteBulk', { as: 'org', method: 'DELETE', path: '/v2/client' });
  await R.req('admin.lrs.delete', { as: 'org', method: 'DELETE', path: `/v2/lrs/${lrs.body._id}` });

  const role = await R.req('admin.role.create', { as: 'org', method: 'POST', path: '/v2/role', json: { title: 'Rôle golden', scopes: ['org/all/dashboard/view'] } });
  await R.req('admin.role.update', { as: 'org', method: 'POST', path: `/v2/role/${role.body._id}`, json: { scopes: ['org/all/dashboard/view', 'org/all/visualisation/view'] } });
  await R.req('admin.role.createAsObservateur', { as: 'observateur', method: 'POST', path: '/v2/role', json: { title: 'interdit', scopes: [] } });

  const user = await R.req('admin.user.create', { as: 'org', method: 'POST', path: '/v2/user', json: { email: 'golden@profenpoche.test', name: 'Golden' } });
  await R.req('admin.user.createExisting', { as: 'org', method: 'POST', path: '/v2/user', json: { email: m.users.analyste.email } });
  await R.req('admin.user.createInvalidEmail', { as: 'org', method: 'POST', path: '/v2/user', json: { email: 'pas-un-email' } });
  await R.req('admin.user.updateName', { as: 'org', method: 'PATCH', path: `/v2/user/${user.body._id}`, json: { name: 'Golden renommé' } });
  await R.req('admin.user.setPasswordShort', { as: 'admin', method: 'PATCH', path: `/v2/user/${user.body._id}`, json: { _id: user.body._id, password: 'court' } });
  await R.req('admin.user.setPassword', { as: 'admin', method: 'PATCH', path: `/v2/user/${user.body._id}`, json: { _id: user.body._id, password: 'Golden-Mot-De-Passe-2026' } });
  await R.req('admin.user.settingsPatch', { as: 'org', method: 'PATCH', path: `/v2/users/${user.body._id}/organisationSettings/${orgId}`, json: { roles: [role.body._id] } });
  await R.req('admin.user.settingsPostDuplicate', { as: 'org', method: 'POST', path: `/v2/users/${user.body._id}/organisationSettings/${orgId}`, json: { scopes: [] } });
  await R.req('admin.user.settingsAsAnalyste', { as: 'analyste', method: 'PATCH', path: `/v2/users/${user.body._id}/organisationSettings/${orgId}`, json: { roles: [] } });
  await R.req('admin.user.settingsSelf', { as: 'analyste', method: 'PATCH', path: `/v2/users/${m.users.analyste.id}/organisationSettings/${orgId}`, json: { samlEnabled: true } });
  await login('admin.user.loginNew', 'golden@profenpoche.test', 'Golden-Mot-De-Passe-2026');
  await R.req('admin.user.settingsDelete', { as: 'org', method: 'DELETE', path: `/v2/users/${user.body._id}/organisationSettings/${orgId}` });
  await R.req('admin.user.removeFromOrg', { as: 'org', method: 'DELETE', path: `/v2/users/${user.body._id}/organisations/${orgId}` });
  await R.req('admin.user.selfRename', { as: 'observateur.user', method: 'PATCH', path: `/v2/user/${m.users.observateur.id}`, json: { _id: m.users.observateur.id, name: 'Olivier Renommé' } });
  await R.req('admin.role.delete', { as: 'org', method: 'DELETE', path: `/v2/role/${role.body._id}` });

  const sub = await R.req('admin.organisation.create', { as: 'org', method: 'POST', path: '/v2/organisation', json: { name: 'Organisation golden', parent: orgId } });
  await R.req('admin.organisation.update', { as: 'org', method: 'PATCH', path: `/v2/organisation/${sub.body._id}`, json: { name: 'Organisation golden renommée', settings: { LOCKOUT_ENABLED: true, LOCKOUT_ATTEMPS: 3, LOCKOUT_SECONDS: 60 } } });
  await R.req('admin.organisation.expirationNonAdmin', { as: 'org', method: 'PATCH', path: `/v2/organisation/${sub.body._id}`, json: { expiration: daysAgo(-30) } });
  await R.req('admin.organisation.expirationSiteAdmin', { as: 'admin', method: 'PATCH', path: `/v2/organisation/${sub.body._id}`, json: { expiration: '2030-01-01T00:00:00.000Z' } });
  await R.req('admin.organisation.uploadLogo', { as: 'admin', method: 'POST', path: '/uploadlogo', query: { data: sub.body._id }, form: { file: { blob: new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), filename: 'logo.png' } } });
  await R.req('admin.organisation.uploadLogoBadType', { as: 'admin', method: 'POST', path: '/uploadlogo', query: { data: sub.body._id }, form: { file: { blob: new Blob(['texte'], { type: 'text/plain' }), filename: 'logo.txt' } } });
  await R.req('admin.organisation.delete', { as: 'org', method: 'DELETE', path: `/v2/organisation/${sub.body._id}` });

  const viz = await R.req('admin.visualisation.create', { as: 'org', method: 'POST', path: '/v2/visualisation', json: { description: 'Viz golden', type: 'COUNTER', axesoperator: 'uniqueCount', axesvalue: JSON.stringify({ optionKey: 'statements', searchString: 'Statements' }), filters: [JSON.stringify({ $match: {} })], owner: adminId } });
  await R.req('admin.visualisation.createInvalidJson', { as: 'org', method: 'POST', path: '/v2/visualisation', json: { description: 'json invalide', axesvalue: '{oups' } });
  await R.req('admin.visualisation.update', { as: 'org', method: 'POST', path: `/v2/visualisation/${viz.body._id}`, json: { description: 'Viz golden modifiée', previewPeriod: 'LAST_7_DAYS' } });
  await R.req('admin.visualisation.updateByAnalyste', { as: 'analyste', method: 'PATCH', path: `/v2/visualisation/${viz.body._id}`, json: { description: 'par l’analyste' } });
  await R.req('admin.visualisation.privateOfAnalyste', { as: 'observateur', path: `/v2/dashboard/${m.dashboards.private}` });
  const dash = await R.req('admin.dashboard.create', { as: 'org', method: 'POST', path: '/v2/dashboard', json: { title: 'Dashboard golden', widgets: [{ x: 0, y: 0, w: 6, h: 6, visualisation: viz.body._id }], owner: adminId } });
  await R.req('admin.dashboard.addShare', { as: 'org', method: 'PATCH', path: `/v2/dashboard/${dash.body._id}`, json: { shareable: [{ title: 'Partage golden', filter: '{}', visibility: 'ANYWHERE', filterMode: 'OFF' }] } });
  await R.req('admin.dashboard.delete', { as: 'org', method: 'DELETE', path: `/v2/dashboard/${dash.body._id}` });
  await R.req('admin.visualisation.delete', { as: 'org', method: 'DELETE', path: `/v2/visualisation/${viz.body._id}` });

  const fwd = await R.req('admin.forwarding.create', { as: 'org', method: 'POST', path: '/v2/statementforwarding', json: { description: 'Forwarding golden', active: false, lrs_id: lrsMain, configuration: { protocol: 'http', url: 'echo:9000/ok/golden', method: 'POST', authType: 'no auth', maxRetries: 1 } } });
  await R.req('admin.forwarding.update', { as: 'org', method: 'PATCH', path: `/v2/statementforwarding/${fwd.body._id}`, json: { query: JSON.stringify({ 'statement.verb.id': verb('completed') }) } });
  await R.req('admin.forwarding.invalidQuery', { as: 'org', method: 'PATCH', path: `/v2/statementforwarding/${fwd.body._id}`, json: { query: '{oups' } });
  await R.req('admin.forwarding.delete', { as: 'org', method: 'DELETE', path: `/v2/statementforwarding/${fwd.body._id}` });

  const q = await R.req('admin.query.create', { as: 'org', method: 'POST', path: '/v2/query', json: { name: 'Requête golden', conditions: JSON.stringify({ $and: [] }), owner: adminId } });
  await R.req('admin.query.delete', { as: 'org', method: 'DELETE', path: `/v2/query/${q.body._id}` });

  const exp = await R.req('admin.export.create', { as: 'org', method: 'POST', path: '/v2/export', json: { name: 'Export golden', owner: adminId } });
  const projection = JSON.parse(exp.body.projections?.[0] ?? '{}');
  const dl = await R.req('admin.export.run', { as: 'org', path: '/export', query: { exportId: exp.body._id, pipelines: [[{ $match: { 'statement.verb.id': verb('failed') } }, { $sort: { timestamp: -1, _id: 1 } }, { $limit: 20 }, { $project: projection }]] }, mode: 'status' });
  if (dl.body?._id) {
    // Le nom contient l'heure locale de création, la clé du fichier un horodatage et un uuid aléatoire.
    await R.req('admin.export.ready', { as: 'org', path: `/v2/download/${dl.body._id}`, mask: ['/name', '/upload/key'], poll: { until: ({ body }) => body?.isReady === true, every: 1000, max: 30 } });
    await R.req('admin.export.csv', { as: 'org', path: `/organisation/${orgId}/downloadexport/${dl.body._id}.csv` });
  }
  await R.req('admin.export.badPipelines', { as: 'org', path: '/export', query: { exportId: exp.body._id, pipelines: '{oups' } });

  // 12. Personas : écritures
  const np = await R.req('persona.write.create', { as: 'org', method: 'POST', path: '/v2/persona', json: { name: 'Persona golden' } });
  await R.req('persona.write.rename', { as: 'org', method: 'PATCH', path: `/v2/persona/${np.body._id}`, json: { name: 'Persona golden renommée' } });
  const npi = await R.req('persona.write.addIdentifier', { as: 'org', method: 'POST', path: '/v2/personaIdentifier', json: { persona: np.body._id, ifi: { key: 'mbox', value: 'mailto:golden@eleves.profenpoche.test' } } });
  await R.req('persona.write.addIdentifierInvalid', { as: 'org', method: 'POST', path: '/v2/personaIdentifier', json: { persona: np.body._id, ifi: { key: 'mbox', value: 'pas-un-mailto' } } });
  await R.req('persona.write.addIdentifierDuplicate', { as: 'org', method: 'POST', path: '/v2/personaIdentifier', json: { persona: np.body._id, ifi: { key: 'mbox', value: 'mailto:golden@eleves.profenpoche.test' } } });
  await R.req('persona.write.upsertNew', { as: 'org', method: 'POST', path: '/v2/personaIdentifier/upsert', json: { ifi: { key: 'account', value: { homePage: ENT_HOMEPAGE, name: 'golden-001' } } } });
  await R.req('persona.write.upsertExisting', { as: 'org', method: 'POST', path: '/v2/personaIdentifier/upsert', json: { ifi: { key: 'mbox', value: 'mailto:golden@eleves.profenpoche.test' } } });
  await R.req('persona.write.attribute', { as: 'org', method: 'POST', path: '/v2/personaattribute', json: { personaId: np.body._id, key: 'classe', value: '3eB' } });
  await R.req('persona.write.uploadJson', { as: 'org', method: 'POST', path: '/uploadpersona', json: { personaName: 'Persona JSON', ifis: [{ key: 'mbox', value: 'mailto:json@eleves.profenpoche.test' }], attributes: [{ key: 'classe', value: '5eC' }] } });
  await R.req('persona.write.uploadJsonMerge', { as: 'org', method: 'POST', path: '/uploadpersona', json: { personaName: 'Persona JSON bis', ifis: [{ key: 'mbox', value: 'mailto:json@eleves.profenpoche.test' }] } });
  await R.req('persona.write.uploadJsonNoArray', { as: 'org', method: 'POST', path: '/uploadpersona', json: { personaName: 'x', ifis: 'pas-un-tableau' } });
  await R.req('persona.write.deleteWithIdentifiers', { as: 'org', method: 'DELETE', path: `/v2/persona/${np.body._id}` });
  await R.req('persona.write.deleteIdentifierUsed', { as: 'org', method: 'DELETE', path: `/v2/personaIdentifier/${pis.body[0]?._id}` });
  await R.req('persona.write.reassignIdentifier', { as: 'org', method: 'PATCH', path: `/v2/personaIdentifier/${npi.body?.identifier?._id ?? npi.body?._id}`, json: { persona: personaId } });
  await R.req('persona.write.reassignNoPersona', { as: 'org', method: 'PATCH', path: `/v2/personaIdentifier/${npi.body?.identifier?._id ?? npi.body?._id}`, json: {} });
  const other = await R.req('persona.write.createForMerge', { as: 'org', method: 'POST', path: '/v2/persona', json: { name: 'À fusionner' } });
  await R.req('persona.write.merge', { as: 'org', method: 'POST', path: '/mergepersona', query: { mergePersonaFromId: other.body._id, mergePersonaToId: np.body._id } });
  await R.req('persona.write.mergeUnknown', { as: 'org', method: 'POST', path: '/mergepersona', query: { mergePersonaFromId: '5f0000000000000000000000', mergePersonaToId: np.body._id } });
  await R.req('persona.write.asObservateur', { as: 'observateur', method: 'POST', path: '/v2/persona', json: { name: 'interdit' } });
  const imp = await R.req('persona.import.create', { as: 'org', method: 'POST', path: '/v2/personasimport', json: { title: 'Import golden', owner: adminId } });
  const csv = 'nom,email\nAlice Golden,alice.golden@eleves.profenpoche.test\nBob Golden,bob.golden@eleves.profenpoche.test\n';
  await R.req('persona.import.upload', { as: 'org', method: 'POST', path: '/uploadpersonas', form: { id: imp.body._id, file: { blob: new Blob([csv], { type: 'text/csv' }), filename: 'golden.csv' } } });
  await R.req('persona.import.uploadNoFile', { as: 'org', method: 'POST', path: '/uploadpersonas', form: { id: imp.body._id } });
  await R.req('persona.attribute.deleteByQuery', { as: 'org', method: 'DELETE', path: '/v2/personaattribute', query: { query: { key: 'classe', value: '3eB' } } });

  // 12 bis. Réglages du site (anomalie connue : modifiables par tout principal authentifié)
  await R.req('siteSettings.get', { as: 'org', path: '/v2/sitesettings/111111111111111111111111' });
  await R.req('siteSettings.patchByClient', { as: 'client.read', method: 'PATCH', path: '/v2/sitesettings/111111111111111111111111', json: { dontShowRegistration: false } });
  await R.req('siteSettings.patchByAdmin', { as: 'admin', method: 'PATCH', path: '/v2/sitesettings/111111111111111111111111', json: { dontShowRegistration: true } });
}
