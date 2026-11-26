#!/usr/bin/env node
// Jeu de données de test Learning Locker : alimente une pile legacy (LL v2 + xapi-service)
// uniquement par ses API publiques, pour que les documents soient écrits par le code d'origine.
// Les modèles front (visualisations, dashboards…) passent par presave-server.js, qui exécute
// le vrai code de sérialisation du front React.
//
// Usage (Node ≥ 22) : node tools/seed/seed.mjs
// Variables : LL_BASE (http://localhost:18080), PRESAVE (http://localhost:18090),
//             ADMIN_EMAIL, ADMIN_PASSWORD, SEED (20261126), STATEMENTS (15000), OUT (./seed-out)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildWorld, generateStatements, generateSpecialStatements, buildAttachmentRequest,
  createRng, VERBS, ENT_HOMEPAGE,
} from './statements.mjs';

const BASE = process.env.LL_BASE ?? 'http://localhost:18080';
const PRESAVE = process.env.PRESAVE ?? 'http://localhost:18090';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@profenpoche.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin-Test-2026';
const SEED = Number(process.env.SEED ?? 20261126);
const STATEMENT_COUNT = Number(process.env.STATEMENTS ?? 15000);
const OUT = process.env.OUT ?? './seed-out';
const USER_PASSWORD = 'Utilisateur-Test-2026';

const NOW = new Date();
NOW.setUTCSeconds(0, 0);
const manifest = { seed: SEED, referenceDate: NOW.toISOString(), base: BASE, steps: [] };
const log = (msg) => { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); manifest.steps.push(msg); };

// ---------------------------------------------------------------------------
// Client HTTP
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

async function http(method, path, { token, basic, json, body, headers = {}, query, expect = [200, 201, 204], raw = false } = {}) {
  const url = new URL(path, BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (basic) h.Authorization = `Basic ${b64(basic)}`;
  let payload = body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(json); }
  const res = await fetch(url, { method, headers: h, body: payload });
  const text = await res.text();
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${url.pathname}${url.search} → ${res.status} ${text.slice(0, 500)}`);
  }
  if (raw) return { status: res.status, headers: res.headers, text };
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

const api = (method, path, opts) => http(method, `/api${path}`, opts);
const xapi = (method, path, client, opts = {}) => http(method, `/data/xAPI${path}`, {
  basic: `${client.api.basic_key}:${client.api.basic_secret}`,
  ...opts,
  headers: { 'X-Experience-API-Version': '1.0.3', ...(opts.headers ?? {}) },
});

async function presave(schema, props) {
  const res = await fetch(`${PRESAVE}/presave`, { method: 'POST', body: JSON.stringify({ schema, props }) });
  const out = await res.json();
  if (!res.ok) throw new Error(`presave ${schema} : ${out.error}`);
  return out;
}
async function template(name, owner) {
  const res = await fetch(`${PRESAVE}/template`, { method: 'POST', body: JSON.stringify({ name, owner }) });
  const out = await res.json();
  if (!res.ok) throw new Error(`template ${name} : ${out.error}`);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const oid = (id) => ({ $oid: id });

// Critère au format du query builder (cf. docs/05-front.md §6.2)
const criterion = (label, path, cond) => ({ $comment: JSON.stringify({ criterionLabel: label, criteriaPath: path }), ...cond });

// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(OUT, { recursive: true });
  const world = buildWorld(createRng(SEED));

  // 1. Connexion administrateur et organisation
  const userToken = await api('POST', '/auth/jwt/password', { basic: `${ADMIN_EMAIL}:${ADMIN_PASSWORD}` });
  const me = JSON.parse(Buffer.from(userToken.split('.')[1], 'base64url').toString());
  const adminId = me.userId;
  const orgs = await api('GET', '/connection/organisation', { token: userToken, query: { filter: {}, first: 10 } });
  const org = orgs.edges.map((e) => e.node).find((o) => !o.parent);
  const orgId = org._id;
  let token = await api('POST', '/auth/jwt/organisation', { token: userToken, json: { organisation: orgId } });
  log(`Connecté : admin ${adminId}, organisation « ${org.name} » ${orgId}`);
  manifest.admin = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, id: adminId };
  manifest.organisation = { id: orgId, name: org.name };

  // Fuseau et règles de mot de passe de l'organisation
  await api('PATCH', `/v2/organisation/${orgId}`, { token, json: { timezone: 'Europe/Paris', settings: { ...org.settings, PASSWORD_MIN_LENGTH: 10 } } });
  // Logo (PNG 1×1)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const logoForm = new FormData();
  logoForm.append('logo', new Blob([png], { type: 'image/png' }), 'logo.png');
  await api('POST', '/uploadlogo', { token, query: { data: orgId }, body: logoForm });
  log('Organisation : fuseau Europe/Paris, règle de mot de passe, logo');

  // 2. Stores (LRS) et clients
  const lrsMain = await api('POST', '/v2/lrs', { token, json: { title: 'LRS Collège', description: 'Store principal du jeu de test' } });
  const lrsSecond = await api('POST', '/v2/lrs', { token, json: { title: 'LRS Lycée', description: 'Store secondaire' } });
  const clientOf = async (lrsId) => (await api('GET', '/v2/client', { token, query: { query: { lrs_id: oid(lrsId) } } }))[0];
  const clientMain = await clientOf(lrsMain._id);
  const clientSecond = await clientOf(lrsSecond._id);
  // Le client principal peut aussi supprimer (suppression par lots) et lire l'API
  await api('PATCH', `/v2/client/${clientMain._id}`, { token, json: await presave('client', { scopes: ['xapi/all', 'all', 'statements/delete'], authority: { objectType: 'Agent', name: 'Plateforme Profenpoche', mbox: 'mailto:plateforme@profenpoche.test' } }) });
  const mkClient = async (title, lrsId, scopes, extra = {}) => api('POST', '/v2/client', {
    token, json: await presave('client', { title, lrs_id: lrsId, scopes, ...extra }),
  });
  const clientRead = await mkClient('Lecture seule', lrsMain._id, ['statements/read']);
  const clientMine = await mkClient('Écriture + lecture des siens', lrsMain._id, ['statements/write', 'statements/read/mine'],
    { authority: { objectType: 'Agent', name: 'App Tangram', account: { homePage: 'https://tangram.profenpoche.test', name: 'app-tangram' } } });
  const clientState = await mkClient('State et profils', lrsMain._id, ['state', 'profile']);
  const clientDisabled = await mkClient('Client désactivé', lrsMain._id, ['xapi/all'], { isTrusted: false });
  const clientApi = await mkClient('API sans store', null, ['all']);
  const refresh = async (c) => (await api('GET', `/v2/client/${c._id}`, { token }));
  const clients = { main: await refresh(clientMain), second: clientSecond, read: clientRead, mine: clientMine, state: clientState, disabled: clientDisabled, api: clientApi };
  manifest.lrs = { main: lrsMain._id, second: lrsSecond._id };
  manifest.clients = Object.fromEntries(Object.entries(clients).map(([k, c]) => [k, { id: c._id, key: c.api.basic_key, secret: c.api.basic_secret, scopes: c.scopes }]));
  log('Stores : 2 LRS ; clients : 7 (dont lecture seule, read/mine, state/profils, désactivé, API sans store)');

  // OAuth2 client_credentials
  const oauth = await api('POST', '/oauth2/token', { json: { grant_type: 'client_credentials', client_id: clients.main.api.basic_key, client_secret: clients.main.api.basic_secret } });
  manifest.oauthToken = oauth.access_token;

  // 3. Rôles, utilisateurs, sous-organisations
  const roles = (await api('GET', '/v2/role', { token })).reduce((acc, r) => ({ ...acc, [r.title]: r._id }), {});
  const roleAnalyste = await api('POST', '/v2/role', { token, json: { title: 'Analyste', description: 'Dashboards et visualisations, sans administration', scopes: ['org/all/dashboard/view', 'org/all/visualisation/edit', 'org/all/visualisation/view', 'org/all/export/view', 'org/all/download/view', 'org/all/query/view'] } });
  const roleReferent = await api('POST', '/v2/role', { token, json: { title: 'Référent personas', description: 'Gestion des personnes', scopes: ['org/all/persona/manage', 'org/public/dashboard/view', 'org/public/visualisation/view'] } });
  const users = {};
  const mkUser = async (key, email, name, roleIds, filter) => {
    const u = await api('POST', '/v2/user', { token, json: { email, isExpanded: true } });
    await api('PATCH', `/v2/user/${u._id}`, { token: userToken, json: { _id: u._id, name, password: USER_PASSWORD } });
    const body = filter ? { roles: roleIds, filter: JSON.stringify(filter) } : { roles: roleIds };
    await api('PATCH', `/v2/users/${u._id}/organisationSettings/${orgId}`, { token, json: body });
    users[key] = { id: u._id, email, password: USER_PASSWORD };
  };
  await mkUser('analyste', 'analyste@profenpoche.test', 'Agathe Analyste', [roleAnalyste._id]);
  await mkUser('observateur', 'observateur@profenpoche.test', 'Olivier Observateur', [roles.Observer]);
  await mkUser('referent', 'referent@profenpoche.test', 'Rémi Référent', [roleReferent._id]);
  await mkUser('filtre', 'filtre@profenpoche.test', 'Fanny Filtrée', [roleAnalyste._id], {
    $and: [criterion('A', ['statement', 'context', 'platform'], { 'statement.context.platform': { $in: ['Profenpoche App'] } })],
  });
  manifest.users = users;

  const subOrg = await api('POST', '/v2/organisation', { token, json: { name: 'Collège Jean Moulin', parent: orgId } });
  const expiredOrg = await api('POST', '/v2/organisation', { token, json: { name: 'Établissement expiré', parent: orgId } });
  await api('PATCH', `/v2/organisation/${expiredOrg._id}`, { token: userToken, json: { expiration: new Date(NOW.getTime() - 86400000).toISOString() } });
  manifest.subOrganisations = { active: subOrg._id, expired: expiredOrg._id };
  // Renouveler le token d'organisation (les rôles ont changé)
  token = await api('POST', '/auth/jwt/organisation', { token: userToken, json: { organisation: orgId } });
  log('Rôles : 2 personnalisés ; utilisateurs : 4 (dont 1 avec filtre de statements) ; sous-organisations : 2 (dont 1 expirée)');

  // 4. Statement forwarding (avant l'envoi des statements)
  const fwd = (description, configuration, extra = {}) => api('POST', '/v2/statementforwarding', {
    token,
    json: { description, active: true, timezone: null, configuration: { protocol: 'http', maxRetries: 2, ...configuration }, ...extra },
  });
  const fwdBasic = await fwd('Vers echo (basic auth, filtre verbe completed)', { url: 'echo:9000/ok/basic', authType: 'basic auth', basicUsername: 'forward', basicPassword: 'secret', headers: JSON.stringify({ 'X-Origine': 'learninglocker' }) }, {
    query: JSON.stringify({ $and: [criterion('A', ['statement', 'verb'], { 'statement.verb.id': { $in: [VERBS.completed[0]] } })] }),
  });
  const fwdToken = await fwd('Vers echo (token, document complet, pièces jointes)', { url: 'echo:9000/ok/token', authType: 'token', secret: 'jeton-de-test' }, { fullDocument: true, sendAttachments: true, query: JSON.stringify({ 'statement.attachments': { $exists: true } }) });
  const fwdFail = await fwd('Destination en erreur (tentatives)', { url: 'echo:9000/fail', authType: 'no auth' }, { query: JSON.stringify({ 'statement.verb.id': VERBS.passed[0] }) });
  const fwdInactive = await fwd('Désactivé', { url: 'echo:9000/ok/inactive', authType: 'no auth' }, { active: false });
  manifest.statementForwarding = { basic: fwdBasic._id, token: fwdToken._id, fail: fwdFail._id, inactive: fwdInactive._id };
  log('Statement forwarding : 4 configurations (basic, token + pièces jointes, en erreur, désactivée)');

  // 5. Statements
  const regular = generateStatements({ seed: SEED, now: NOW, count: STATEMENT_COUNT, world });
  const storedIds = [];
  for (let i = 0; i < regular.length; i += 250) {
    const ids = await xapi('POST', '/statements', clients.main, { json: regular.slice(i, i + 250) });
    storedIds.push(...ids);
  }
  log(`Statements : ${regular.length} statements ordinaires sur « LRS Collège »`);

  const special = generateSpecialStatements({ seed: SEED, now: NOW, world, existingIds: storedIds });
  await xapi('POST', '/statements', clients.main, { json: [...special.voidable, ...special.refs, ...special.groups, ...special.subStatements, ...special.agentObjects, ...special.toDelete] });
  await xapi('POST', '/statements', clients.main, { json: special.voiding });
  for (const st of special.putById) {
    await xapi('PUT', '/statements', clients.main, { query: { statementId: st.id }, json: st });
  }
  // Renvoi à l'identique (même hash : ignoré) et conflit (hash différent : 409)
  await xapi('PUT', '/statements', clients.main, { query: { statementId: special.putById[0].id }, json: special.putById[0] });
  await xapi('PUT', '/statements', clients.main, { query: { statementId: special.putById[0].id }, json: { ...special.putById[0], verb: { id: VERBS.completed[0] } }, expect: [409] });
  for (let i = 0; i < 6; i += 1) {
    const att = buildAttachmentRequest({ world, now: NOW, index: i });
    await xapi('POST', '/statements', clients.main, { body: att.body, headers: { 'Content-Type': att.contentType } });
  }
  // Priorité basse et files contournées (extensions LL)
  await xapi('POST', '/statements', clients.main, { query: { priority: 'LOW' }, json: generateStatements({ seed: SEED + 1, now: NOW, count: 20, world }) });
  await xapi('POST', '/statements', clients.main, { query: { bypassQueues: 'STATEMENT_FORWARDING_QUEUE' }, json: generateStatements({ seed: SEED + 2, now: NOW, count: 20, world }) });
  // Autres stores et clients
  await xapi('POST', '/statements', clients.second, { json: generateStatements({ seed: SEED + 3, now: NOW, count: 300, world }) });
  await xapi('POST', '/statements', clients.mine, { json: generateStatements({ seed: SEED + 4, now: NOW, count: 50, world }) });
  await http('POST', '/data/xAPI/statements', { token: oauth.access_token, headers: { 'X-Experience-API-Version': '1.0.3' }, json: generateStatements({ seed: SEED + 5, now: NOW, count: 10, world }) });
  // Client désactivé : refusé
  await xapi('POST', '/statements', clients.disabled, { json: generateStatements({ seed: SEED + 6, now: NOW, count: 1, world }), expect: [403] });
  log('Statements : annulations (20), références (10), groupes (10), sous-statements (5), agents en objet (10), PUT (5), conflit 409, pièces jointes (6), priorité LOW, bypassQueues, 2e store (300), client read/mine (50), OAuth (10), client désactivé refusé');

  // 6. State et profils xAPI
  const learner = world.learners[0].actor;
  const course = world.courses[0].id;
  const reg = createRng(SEED + 7).uuid();
  const sq = (o) => ({ activityId: course, agent: JSON.stringify(learner), ...o });
  await xapi('PUT', '/activities/state', clients.state, { query: sq({ stateId: 'progression', registration: reg }), json: { chapitre: 2, page: 14 } });
  await xapi('POST', '/activities/state', clients.state, { query: sq({ stateId: 'progression', registration: reg }), json: { termine: false } });
  await xapi('PUT', '/activities/state', clients.state, { query: sq({ stateId: 'capture' }), body: Buffer.from([0, 1, 2, 3, 254, 255]), headers: { 'Content-Type': 'application/octet-stream' } });
  await xapi('PUT', '/activities/profile', clients.state, { query: { activityId: course, profileId: 'configuration' }, json: { difficulte: 'moyenne', chrono: true }, headers: { 'If-None-Match': '*' } });
  await xapi('PUT', '/agents/profile', clients.state, { query: { agent: JSON.stringify(learner), profileId: 'preferences' }, json: { theme: 'sombre', langue: 'fr' }, headers: { 'If-None-Match': '*' } });
  await xapi('PUT', '/agents/profile', clients.state, { query: { agent: JSON.stringify(learner), profileId: 'notes.txt' }, body: 'Élève à suivre en géométrie.', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } });
  log('xAPI : 2 states (JSON fusionné, binaire), 1 profil d’activité, 2 profils d’agent (JSON, texte)');

  // 7. Attendre le worker (personas, cache du query builder, forwarding)
  const total = async () => (await api('GET', '/statements/count', { token, query: { filter: {} } })).count;
  const done = async () => (await api('GET', '/statements/count', { token, query: { filter: { processingQueues: { $size: 0 }, 'completedQueues.2': { $exists: true } } } })).count;
  const expected = await total();
  for (let t = 0; t < 180; t += 1) {
    const n = await done();
    if (t % 6 === 0) log(`Worker : ${n}/${expected} statements traités`);
    if (n >= expected - 25) break; // marge : statements de priorité LOW jamais notifiés si ENABLE_QUEUE_PRIORITY
    await sleep(10000);
  }

  // 8. Personas : import CSV, édition manuelle, fusion
  const csvRows = [['nom', 'email', 'ent_id', 'ent_url', 'classe', 'etablissement']];
  world.learners.slice(0, 52).forEach((l) => {
    const email = l.actor.mbox ? l.actor.mbox.replace('mailto:', '') : '';
    const entId = l.actor.account ? l.actor.account.name : '';
    csvRows.push([l.name, email, entId, entId ? ENT_HOMEPAGE : '', l.classe, l.index % 2 ? 'Collège Jean Moulin' : 'Collège Victor Hugo']);
  });
  csvRows.push(['Nouvelle Élève', 'nouvelle.eleve@eleves.profenpoche.test', '', '', '6eA', 'Collège Jean Moulin']);
  csvRows.push(['Ligne en erreur', 'pas-un-email', '', '', '6eA', '']);
  const csv = csvRows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  writeFileSync(join(OUT, 'personas.csv'), csv);
  const imp = await api('POST', '/v2/personasimport', { token, json: { title: 'Import élèves 2026', owner: adminId } });
  const upForm = new FormData();
  upForm.append('id', imp._id);
  upForm.append('file', new Blob([csv], { type: 'text/csv' }), 'personas.csv');
  const uploaded = await api('POST', '/uploadpersonas', { token, body: upForm });
  const col = (columnName, columnType, extra = {}) => ({ columnName, columnType, relatedColumn: null, primary: null, useConstant: false, ...extra });
  const structure = {
    nom: col('nom', 'COLUMN_NAME'),
    email: col('email', 'COLUMN_MBOX', { primary: 1 }),
    ent_id: col('ent_id', 'COLUMN_ACCOUNT_VALUE', { relatedColumn: 'ent_url', primary: 2 }),
    ent_url: col('ent_url', 'COLUMN_ACCOUNT_KEY', { relatedColumn: 'ent_id' }),
    classe: col('classe', 'COLUMN_ATTRIBUTE_DATA', { attributeName: 'classe' }),
    etablissement: col('etablissement', 'COLUMN_ATTRIBUTE_DATA', { attributeName: 'etablissement' }),
  };
  await api('PATCH', `/v2/personasimport/${imp._id}`, { token, json: { ...uploaded, structure } });
  await api('POST', '/importpersonas', { token, json: { id: imp._id } });
  for (let t = 0; t < 60; t += 1) {
    const st = await api('GET', `/v2/personasimport/${imp._id}`, { token });
    if (st.importStage === 'STAGE_IMPORTED') { log(`Personas : import CSV terminé (${st.result?.created} créées, ${st.result?.merged} fusionnées, ${st.importErrors?.length ?? 0} ligne(s) en erreur)`); break; }
    await sleep(5000);
  }
  manifest.personasImport = imp._id;

  const persona = await api('POST', '/v2/persona', { token, json: { name: 'Persona créée à la main' } });
  await api('POST', '/v2/personaIdentifier', { token, json: { persona: persona._id, ifi: { key: 'mbox', value: 'mailto:manuel@profenpoche.test' } } });
  await api('POST', '/v2/personaIdentifier', { token, json: { persona: persona._id, ifi: { key: 'account', value: { homePage: ENT_HOMEPAGE, name: 'manuel-001' } } } });
  await api('POST', '/v2/personaattribute', { token, json: { personaId: persona._id, key: 'role', value: 'délégué' } });
  const target = await api('POST', '/v2/persona', { token, json: { name: 'Persona cible de fusion' } });
  await api('POST', '/v2/personaIdentifier', { token, json: { persona: target._id, ifi: { key: 'openid', value: 'https://openid.profenpoche.test/fusion' } } });
  await api('POST', '/mergepersona', { token, query: { mergePersonaFromId: persona._id, mergePersonaToId: target._id } });
  log('Personas : création manuelle, identifiants mbox/account/openid, attribut, fusion');

  // 9. Visualisations
  const vizIds = {};
  const mkViz = async (key, props) => {
    const v = await api('POST', '/v2/visualisation', { token, json: await presave('visualisation', { owner: adminId, timezone: null, ...props }) });
    vizIds[key] = v._id;
    return v._id;
  };
  const verbIn = (label, ...keys) => criterion(label, ['statement', 'verb'], { 'statement.verb.id': { $in: keys.map((k) => VERBS[k][0]) } });
  const val = (optionKey, searchString = optionKey) => ({ optionKey, searchString });
  const sinceDte = new Date(NOW.getTime() - 90 * 86400000).toISOString().slice(0, 16);

  await mkViz('barScore', { type: 'LEADERBOARD', description: 'Score moyen par activité', axesoperator: 'average', axesvalue: val('scaled', 'Scaled Score'), axesgroup: val('activities', 'Activity'), axesxLabel: 'Score', axesyLabel: 'Activité', barChartGroupingLimit: 15, timezone: 'Europe/Paris',
    filters: [{ label: 'Réussites', color: '#36D7B7', $match: { $and: [verbIn('A', 'passed')] } }, { label: 'Échecs', color: '#ED4444', $match: { $and: [verbIn('A', 'failed')] } }] });
  await mkViz('barClasse', { type: 'LEADERBOARD', description: 'Statements par classe (attribut importé)', axesoperator: 'uniqueCount', axesvalue: val('statements', 'Statements'), axesgroup: val('persona.import.classe'), previewPeriod: 'LAST_6_MONTHS' });
  await mkViz('barCategorie', { type: 'LEADERBOARD', description: 'Par regroupement (contextActivities)', axesoperator: 'uniqueCount', axesvalue: val('people', 'People'), axesgroup: { ...val('statement.context.contextActivities.grouping'), contextActivityDefinitionType: 'http://id.tincanapi.com/activitytype/school-assignment' }, sourceView: true, showStats: false, statsAtBottom: false });
  await mkViz('barExtension', { type: 'LEADERBOARD', description: 'Par appareil (extension de contexte)', axesoperator: 'uniqueCount', axesvalue: val('statements', 'Statements'), axesgroup: val('statement.context.extensions.https://profenpoche&46;test/xapi/extensions/appareil') });
  await mkViz('colJour', { type: 'STATEMENTS', description: 'Apprenants actifs par jour de la semaine', axesoperator: 'uniqueCount', axesvalue: val('people', 'People'), axesgroup: val('weekday', 'Day'), stacked: false,
    filters: [{ label: 'App', $match: { $and: [criterion('A', ['statement', 'context', 'platform'], { 'statement.context.platform': { $in: ['Profenpoche App'] } })] } }, { label: 'Moodle', $match: { $and: [criterion('A', ['statement', 'context', 'platform'], { 'statement.context.platform': { $in: ['Moodle'] } })] } }, { label: 'Social', $match: { $and: [criterion('A', ['statement', 'context', 'platform'], { 'statement.context.platform': { $nin: ['Profenpoche App', 'Moodle'] } })] } }] });
  await mkViz('colMois', { type: 'STATEMENTS', description: 'Moyenne de statements par mois', axesoperator: 'uniqueAverage', axesvalue: val('statements', 'Statements'), axesgroup: val('month', 'Month'), previewPeriod: 'LAST_1_YEAR' });
  await mkViz('colRaw', { type: 'STATEMENTS', description: 'Somme des scores bruts par verbe', axesoperator: 'count', axesvalue: val('raw', 'Raw Score'), axesgroup: val('verb', 'Verb') });
  await mkViz('ligne', { type: 'FREQUENCY', description: 'Activité sur 30 jours', axesoperator: 'uniqueCount', axesvalue: val('statements', 'Statements'), axesxLabel: 'Date', previewPeriod: 'LAST_30_DAYS',
    filters: [{ label: 'Terminés', $match: { $and: [verbIn('A', 'completed')] } }, { label: 'Tentés', $match: { $and: [verbIn('A', 'attempted'), criterion('B', ['timestamp'], { timestamp: { $gt: { $dte: `${sinceDte}+01:00` } } })] } }] });
  await mkViz('ligneMax', { type: 'FREQUENCY', description: 'Score max sur 6 mois', axesoperator: 'max', axesvalue: val('scaled', 'Scaled Score'), previewPeriod: 'LAST_6_MONTHS', timezone: '+05:30' });
  await mkViz('xvsy', { type: 'XVSY', description: 'Score moyen vs nombre de statements', axesgroup: val('people', 'Person'), axesxLabel: 'Score moyen', axesxOperator: 'average', axesxValue: val('scaled', 'Scaled Score'), axesxQuery: { $match: { $and: [verbIn('A', 'passed', 'failed')] } }, axesyLabel: 'Statements', axesyOperator: 'uniqueCount', axesyValue: val('statements', 'Statements'), axesyQuery: {}, trendLines: true });
  await mkViz('compteur', { type: 'COUNTER', description: 'Apprenants actifs', axesoperator: 'uniqueCount', axesvalue: val('people', 'People'), benchmarkingEnabled: true, contextLabel: 'apprenants actifs', previewPeriod: 'LAST_30_DAYS' });
  await mkViz('compteurJour', { type: 'COUNTER', description: 'Points du jour (score brut)', axesoperator: 'count', axesvalue: val('raw', 'Raw Score'), previewPeriod: 'TODAY',
    filters: [{ $match: { $and: [criterion('A', ['statement', 'result', 'score', 'scaled'], { 'statement.result.score.scaled': { $gte: 0.5 } })] } }] });
  await mkViz('pieVerbes', { type: 'PIE', description: 'Répartition des verbes', axesoperator: 'uniqueCount', axesvalue: val('statements', 'Statements'), axesgroup: val('verb', 'Verb'), isDonut: true,
    filters: [{ label: 'Store collège', $match: { $and: [criterion('A', ['lrs_id'], { lrs_id: { $in: [oid(lrsMain._id)] } })] } }, { label: 'Tous', $match: {} }] });
  await mkViz('pieReponses', { type: 'PIE', description: 'Réponses à la question 1', axesoperator: 'uniqueCount', axesvalue: val('statements', 'Statements'), axesgroup: val('response', 'Response'),
    filters: [{ $match: { $and: [criterion('A', ['statement', 'object'], { 'statement.object.id': { $in: [world.interactions[0].object.id] } })] } }] });
  await mkViz('barPersonaIdent', { type: 'LEADERBOARD', description: 'Classe 4eA (filtre $personaIdent)', axesoperator: 'uniqueCount', axesvalue: val('statements', 'Statements'), axesgroup: val('activities', 'Activity'),
    filters: [{ $match: { $and: [criterion('A', ['persona', 'import', 'classe'], { 'person._id': { $personaIdent: { key: 'persona.import.classe', value: '4eA' } } })] } }] });
  await mkViz('nonType', { description: 'Visualisation sans type (création interrompue)' });

  const templateNames = await (await fetch(`${PRESAVE}/templates`, { method: 'POST' })).json();
  for (const name of templateNames) {
    const v = await api('POST', '/v2/visualisation', { token, json: await template(name, adminId) });
    vizIds[name] = v._id;
  }
  manifest.visualisations = vizIds;
  log(`Visualisations : ${Object.keys(vizIds).length} (tous les types personnalisés, les 13 modèles, séries, fuseaux, $dte/$oid/$personaIdent)`);

  // 10. Dashboards (mêmes compositions que les sagas du front)
  const mkDash = async (props) => api('POST', '/v2/dashboard', { token, json: await presave('dashboard', { owner: adminId, ...props }) });
  const t = (n) => vizIds[n];
  const gettingStarted = await mkDash({ title: 'Getting Started', type: 'gettingStarted', isExpanded: true, widgets: [
    { x: 0, y: 0, w: 6, h: 8, visualisation: t('TemplateLast7DaysStatements') },
    { x: 6, y: 0, w: 6, h: 8, visualisation: t('TemplateActivityOverTime') },
    { x: 0, y: 8, w: 6, h: 9, visualisation: t('TemplateMostPopularVerbs') },
    { x: 6, y: 8, w: 6, h: 9, visualisation: t('TemplateMostPopularActivities') },
    { x: 0, y: 17, w: 6, h: 9, visualisation: t('TemplateMostActivePeople') },
    { x: 6, y: 17, w: 6, h: 9, visualisation: t('TemplateWeekdaysActivity') },
  ] });
  const streamStarter = await mkDash({ title: 'Stream Starter', type: 'streamStarter', isExpanded: true, widgets: [
    { x: 0, y: 0, w: 6, h: 8, visualisation: t('TemplateStreamInteractionsVsEngagement') },
    { x: 6, y: 0, w: 3, h: 8, visualisation: t('TemplateStreamCommentCount') },
    { x: 9, y: 0, w: 3, h: 8, visualisation: t('TemplateLast7DaysStatements') },
    { x: 0, y: 8, w: 6, h: 9, visualisation: t('TemplateStreamLearnerInteractionsByDateAndVerb') },
    { x: 6, y: 8, w: 6, h: 9, visualisation: t('TemplateStreamUserEngagementLeaderboard') },
    { x: 0, y: 17, w: 6, h: 9, visualisation: t('TemplateStreamProportionOfSocialInteractions') },
    { x: 6, y: 17, w: 6, h: 9, visualisation: t('TemplateStreamActivitiesWithMostComments') },
  ] });
  const blank = await mkDash({ title: 'Blank Dashboard', type: 'blankDashboard', isExpanded: true });
  const keys = ['barScore', 'barClasse', 'barCategorie', 'barExtension', 'colJour', 'colMois', 'colRaw', 'ligne', 'ligneMax', 'xvsy', 'compteur', 'compteurJour', 'pieVerbes', 'pieReponses', 'barPersonaIdent'];
  const custom = await mkDash({
    title: 'Pilotage collège',
    widgets: keys.map((k, i) => ({ title: i % 3 === 0 ? `Widget ${k}` : undefined, visualisation: vizIds[k], x: (i % 2) * 6, y: Math.floor(i / 2) * 8, w: 6, h: 8 })),
    shareable: [
      { title: 'Privé (jamais visible)', filter: {}, visibility: 'NOWHERE' },
      { title: 'Public sans filtre', filter: {}, visibility: 'ANYWHERE', filterMode: 'OFF', timezone: null },
      { title: 'Public filtre libre', filter: { $and: [criterion('A', ['statement', 'context', 'platform'], { 'statement.context.platform': { $in: ['Profenpoche App'] } })] }, visibility: 'ANYWHERE', filterMode: 'ANY', timezone: 'Europe/Paris' },
      { title: 'Domaines autorisés', filter: {}, visibility: 'VALID_DOMAINS', validDomains: '*.profenpoche.test', filterMode: 'OFF' },
      { title: 'Filtre signé JWT', filter: {}, visibility: 'ANYWHERE', filterMode: 'JWT_SECURED', filterJwtSecret: 'secret-de-filtre-de-test', filterRequired: true },
    ],
  });
  const priv = await mkDash({ title: 'Dashboard privé de l’analyste', owner: users.analyste.id, isPublic: false });
  const pub = await mkDash({ title: 'Dashboard public', isPublic: true, widgets: [{ x: 0, y: 0, w: 4, h: 4, visualisation: vizIds.compteur }] });
  manifest.dashboards = { gettingStarted: gettingStarted._id, streamStarter: streamStarter._id, blank: blank._id, custom: custom._id, shareables: custom.shareable.map((s) => ({ id: s._id, title: s.title })), private: priv._id, public: pub._id };
  log('Dashboards : Getting Started, Stream Starter, vierge, personnalisé (15 widgets, 5 partages), privé, public');

  // 11. Requêtes sauvegardées, exports, métadonnées, suppression par lots
  await api('POST', '/v2/query', { token, json: await presave('query', { name: 'Évaluations réussies', owner: adminId, conditions: { $and: [verbIn('A', 'passed')] } }) });
  await api('POST', '/v2/query', { token, json: await presave('query', { name: 'Requête vide', owner: adminId, conditions: {} }) });
  const exp = await api('POST', '/v2/export', { token, json: { name: 'Export complet', owner: adminId } });
  const projection = JSON.parse(exp.projections[0]);
  const dl = await api('GET', '/export', { token, query: { exportId: exp._id, pipelines: [[{ $match: {} }, { $sort: { timestamp: -1, _id: 1 } }, { $project: projection }]] } });
  manifest.export = { id: exp._id, download: dl._id };

  const someStatement = (await api('GET', '/connection/statement', { token, query: { filter: { 'statement.verb.id': VERBS.passed[0] }, first: 1 } })).edges[0].node;
  await api('PATCH', `/v2/statementmetadata/${someStatement._id}`, { basic: `${clients.main.api.basic_key}:${clients.main.api.basic_secret}`, json: { 'https://profenpoche.test/meta.revue': { relu: true, par: 'enseignant1' } } });
  const bd = await api('POST', '/v2/batchdelete/initialise', { basic: `${clients.main.api.basic_key}:${clients.main.api.basic_secret}`, json: { filter: { 'statement.verb.id': VERBS.toDelete[0] } } });
  manifest.batchDelete = bd._id;
  await api('PATCH', '/v2/sitesettings/111111111111111111111111', { token: userToken, json: { dontShowRegistration: true } });
  log('Requêtes sauvegardées (2), export CSV, métadonnées de statement, suppression par lots (30 statements), bannière d’enregistrement masquée');

  // 12. Bilan
  for (let i = 0; i < 30; i += 1) {
    const d = await api('GET', `/v2/batchdelete/${bd._id}`, { basic: `${clients.main.api.basic_key}:${clients.main.api.basic_secret}` });
    if (d.done) break;
    await sleep(5000);
  }
  manifest.counts = { statements: await total() };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`Terminé. Manifeste : ${join(OUT, 'manifest.json')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
