#!/usr/bin/env node
// Oracle des briques communes du lot 4 (hors pipelines de visualisation, voir pipelines.mjs) :
// parseQuery, scopes, validation (mots de passe, IFI), sérialisation des schémas du front,
// utilitaires du query builder. Chaque cas est calculé par le VRAI code legacy, via
// tools/oracle/legacy/lib-oracle-server.js (image legacy, sans accès à la base, faux déterministes).
//
// Relancer (sur la VM, depuis ~/legacy, après copie de tools/oracle → ~/legacy/oracle) :
//   ./oracle/libs.sh                    # démarre ll-lib-oracle (127.0.0.1:18092), génère, arrête
//   scp -P 2222 'sam@localhost:legacy/oracle/out/*.json.gz' packages/shared/test/fixtures/   # sur l'hôte
// Ou, serveur déjà lancé (./oracle/libs.sh start) :
//   ORACLE=http://127.0.0.1:18092 node oracle/libs.mjs oracle/out [catégorie…]
//
// Variables : ORACLE (défaut http://127.0.0.1:18092), SEED (défaut 20261127), MONGO_URL (base legacy,
// lue en LECTURE SEULE par mongosh pour la catégorie schemas ; défaut mongodb://127.0.0.1:27018/learninglocker_v2).
// Sortie : <dossier>/<catégorie>.json.gz = { meta, cases: [{ id, input, output }] } ; les valeurs sont
// « étiquetées » ($$oid, $$date, $$undefined, $$error… : voir tag() du serveur).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ORACLE = process.env.ORACLE ?? 'http://127.0.0.1:18092';
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/learninglocker_v2';
const SEED = Number(process.env.SEED ?? 20261127);
const outDir = resolve(process.argv[2] ?? 'oracle/out');
const only = process.argv.slice(3);

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let rnd = mulberry32(SEED);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
const sample = (list, n) => Array.from({ length: n }, () => pick(list));

async function call(route, body) {
  const res = await fetch(`${ORACLE}/${route}`, { method: 'POST', body: JSON.stringify(body) });
  const json = await res.json();
  // Le code legacy a levé une erreur : elle fait partie du résultat attendu.
  if (!json.ok) {
    if (!json.error || !json.error.$$error) throw new Error(`${route} : ${JSON.stringify(json.error)}\n${json.stack}`);
    return { $$thrown: json.error.$$error };
  }
  return json.value;
}

function write(category, cases, description) {
  mkdirSync(outDir, { recursive: true });
  const data = { meta: { category, description, generator: 'tools/oracle/libs.mjs', seed: SEED, cases: cases.length }, cases };
  const gz = gzipSync(JSON.stringify(data), { level: 9 });
  const file = join(outDir, `${category}.json.gz`);
  writeFileSync(file, gz);
  console.log(`${category} : ${cases.length} cas → ${file} (${(gz.length / 1024).toFixed(0)} Kio)`);
}

// --- parseQuery -------------------------------------------------------------------------------------

const ORG = '6b083fe419b92523f89d6725';
const P = (n) => `6b0847194f911ed4209900${String(n).padStart(2, '0')}`;
const ATTRIBUTES = [
  { key: 'classe', value: '4eB', personaId: P(1) },
  { key: 'classe', value: '4eB', personaId: P(2), organisation: ORG },
  { key: 'classe', value: '4eB', personaId: null },
  { key: 'classe', value: '4eB' },
  { key: 'classe', value: '3eA', personaId: P(3), organisation: '6b083feb4f911eb3ee997f07' },
  { key: 'niveau', value: { a: 1 }, personaId: P(4) },
  { key: 'persona.import.x', value: 'v', personaId: P(5) },
  { key: 'x', value: 'v', personaId: P(6) },
  { key: 'age', value: 12, personaId: P(7) },
];
const AUTH_INFOS = [
  { name: 'org', options: { authInfo: { token: { tokenType: 'organisation', tokenId: ORG } } } },
  { name: 'worker', options: { authInfo: { token: { tokenType: 'worker', tokenId: ORG } } } },
  { name: 'user-org', options: { authInfo: { token: { tokenType: 'user', organisationId: '6b083feb4f911eb3ee997f07' } } } },
  { name: 'client', options: { authInfo: { client: { organisation: ORG } } } },
  { name: 'dashboard', options: { authInfo: { token: { tokenType: 'dashboard', organisation: ORG } } } },
  { name: 'empty-auth', options: { authInfo: {} } },
  { name: 'no-auth', options: {} },
  { name: 'scope-error', options: { authInfo: { scopeError: true, token: { tokenType: 'organisation', tokenId: ORG } } } },
];
const OIDS = ['6b083fe419b92523f89d6725', '6B083FE419B92523F89D6725', 'abcdefghijkl', 'abc€efghijkl', 'zz083fe419b92523f89d6725', '', 'court', true, [1], { a: 1 },
  { toHexString: 1 }, { toHexString: 1, id: 'abcdefghijkl' }, { toHexString: 1, id: '6b083fe419b92523f89d6725' }];
const DTES = ['2026-01-01', '2026-01', '2026', '2026-01-01T10:00', '2026-01-01T10:00:30', '2026-01-01T10:00:30.123', '2026-01-01T10:00:30.123456',
  '2026-01-01T10:00Z', '2026-01-01T10:00+05:30', '2026-01-01T10:00:00.000-03:00', '2026-03-29T02:30', '2026-10-25T02:30:00', '+002026-01-01T00:00',
  'Jan 1 2026 10:00 GMT+0200', 'Thu, 01 Jan 2026 10:00:00 GMT', '2026/01/01 10:00 UTC', 'Jan 1 2026 10:00', '2026-01-01 10:00', 'pas une date', '',
  0, 1767225600000, -1, null, true, ['2026-01-01T00:00Z'], { a: 1 }];
const STATEMENT_DATES = [
  () => ({ 'statement.timestamp': { $gte: { $dte: pick(DTES) }, $lt: '2026-06-01T00:00' } }),
  () => ({ 'statement.timestamp': pick(['2026-01-01', '2026-01-01T00:00', 'x']) }),
  () => ({ 'statement.stored': { $in: ['2026-01-01'] }, a: 1 }),
  () => ({ 'statement.stored': 5, timestamp: 'avant' }),
  () => ({ timestamp: 1, 'statement.timestamp': { $gt: '2026-01-01T00:00' } }),
  () => ({ statement: { timestamp: '2026-01-01T00:00' } }),
  () => ({ statement: { stored: { $gt: '2026-01-01' } }, stored: 'garde' }),
  () => ({ $and: [{ 'statement.timestamp': { $gte: { $dte: pick(DTES) } } }, { 'statement.stored': { $lte: '2026-02-01T00:00' } }] }),
  () => ({ $or: [{ 'statement.timestamp': null }, { 'statement.stored': [1, '2'] }] }),
  () => ({ 'statement.timestamp': { 'statement.timestamp': '2026-01-01T00:00' } }),
];
const PERSONA_IDENTS = [
  { key: 'persona.import.classe', value: '4eB' },
  { key: 'classe', value: '4eB' },
  { key: 'persona.import.classe', value: '3eA' },
  { key: 'persona.import.niveau', value: { a: 1 } },
  { key: 'persona.import.persona.import.x', value: 'v' },
  { key: 'persona.import.age', value: 12 },
  { key: 'persona.import.inconnu', value: 'z' },
  { key: 'boom', value: 'x' },
];
const PERSONA_IDENTS_THROWING = [{ key: 5, value: 'x' }, { value: 'x' }, 'chaine', null];

const matchFragment = () => {
  const r = rnd();
  if (r < 0.2) return { 'person._id': { $in: sample(OIDS, 1 + Math.floor(rnd() * 3)).map((oid) => ({ $oid: oid })) } };
  if (r < 0.35) return { timestamp: { $gte: { $dte: pick(DTES) } }, stored: { $lt: { $dte: pick(DTES) } } };
  if (r < 0.6) return pick(STATEMENT_DATES)();
  if (r < 0.75) return { 'person._id': { $personaIdent: pick(PERSONA_IDENTS) } };
  if (r < 0.82) return { lrs_id: { $oid: pick(OIDS) }, $comment: 'x', other: { $oid: pick(OIDS), extra: 1 } };
  if (r < 0.9) return { a: { $dte: { $oid: OIDS[0] } }, b: { $oid: { $dte: '2026-01-01T00:00Z' } } };
  return { $and: [matchFragmentSimple(), matchFragmentSimple()] };
};
const matchFragmentSimple = () => pick([
  { 'statement.verb.id': 'http://adlnet.gov/expapi/verbs/passed' },
  { voided: false },
  { 'statement.timestamp': '2026-01-01T00:00' },
  { 'person._id': { $personaIdent: pick(PERSONA_IDENTS) } },
  { timestamp: { $dte: pick(DTES) } },
]);
const lookupStage = (depth = 0) => {
  const from = pick(['personas', 'personaIdentifiers', 'personaAttributes', 'statements', 'journeys', 'journeyprogresses', 'users', 'organisations', undefined, 5]);
  const lookup = { as: 'x' };
  if (from !== undefined) lookup.from = from;
  const r = rnd();
  if (r < 0.4 && depth < 2) lookup.pipeline = [{ $match: matchFragment() }, ...(chance(0.5) ? [lookupStage(depth + 1)] : []), ...(chance(0.3) ? [{ $out: 'y' }] : [])];
  else if (r < 0.45) lookup.pipeline = 'ab';
  return { $lookup: lookup };
};
const stage = () => {
  const r = rnd();
  if (r < 0.35) return { $match: matchFragment() };
  if (r < 0.45) return { $sort: pick([{ 'statement.timestamp': -1 }, { 'statement.stored': 1, _id: 1 }, { 'statement.timestamp': { x: 1 } }, { timestamp: -1 }]) };
  if (r < 0.6) return lookupStage();
  if (r < 0.65) return { $out: 'collection' };
  if (r < 0.7) return { $out: 'x', $match: { a: 1 } };
  if (r < 0.75) return { $facet: { a: [{ $out: 'y' }, { $match: matchFragmentSimple() }], b: [lookupStage()] } };
  if (r < 0.8) return { $match: matchFragment(), $sort: { 'statement.timestamp': 1 } };
  if (r < 0.85) return { $group: { _id: '$x', d: { $max: { $dte: pick(DTES) } }, o: { $first: { $oid: pick(OIDS) } } } };
  if (r < 0.9) return { $project: { a: { $out: 1 }, lookup: { $lookup: { from: 'users' } } } };
  return { $limit: pick([10, 0, '5']) };
};

async function parseQueryCases() {
  rnd = mulberry32(SEED);
  const cases = [];
  const add = async (id, pipeline, auth = pick(AUTH_INFOS)) => {
    const input = { pipeline, options: auth.options, attributes: ATTRIBUTES };
    cases.push({ id, input, output: await call('parseQuery', input) });
  };
  for (let n = 0; n < 1200; n += 1) {
    const stages = Array.from({ length: 1 + Math.floor(rnd() * 5) }, stage);
    const r = rnd();
    if (r < 0.1) await add(`pipeline-string/${n}`, JSON.stringify(stages));
    else if (r < 0.3) await add(`filter/${n}`, matchFragment());
    else if (r < 0.35) await add(`filter-string/${n}`, JSON.stringify(matchFragment()));
    else await add(`pipeline/${n}`, stages);
  }
  for (const oid of OIDS) for (const auth of AUTH_INFOS.slice(0, 2)) await add(`oid/${JSON.stringify(oid)}/${auth.name}`, [{ $match: { a: { $oid: oid }, b: [{ $oid: oid }] } }], auth);
  for (const dte of DTES) {
    await add(`dte/${JSON.stringify(dte)}`, [{ $match: { a: { $dte: dte }, 'statement.timestamp': { $gte: dte } } }]);
    if (typeof dte === 'string') await add(`statement-date/${JSON.stringify(dte)}`, { 'statement.stored': dte, 'statement.timestamp': { $lt: dte } });
  }
  for (const [i, make] of STATEMENT_DATES.entries()) for (const auth of AUTH_INFOS.slice(6, 7)) await add(`statement-dates/${i}`, [{ $match: make() }, { $sort: { 'statement.timestamp': -1, 'statement.stored': 1 } }], auth);
  for (const ident of [...PERSONA_IDENTS, ...PERSONA_IDENTS_THROWING]) {
    for (const auth of AUTH_INFOS) await add(`persona/${JSON.stringify(ident)}/${auth.name}`, { 'person._id': { $personaIdent: ident }, x: [{ $personaIdent: ident }] }, auth);
  }
  for (const auth of AUTH_INFOS) {
    await add(`lookup/${auth.name}`, [{ $lookup: { from: 'personas', as: 'p' } }, { $lookup: { from: 'users' } }, { $lookup: { from: 'statements', pipeline: [{ $lookup: { from: 'personaAttributes', pipeline: [] } }, { $lookup: { from: 'lrs' } }] } }], auth);
    await add(`lookup-object/${auth.name}`, { $lookup: { from: 'users', as: 'u' }, nested: { $lookup: { from: 'constructor' } } }, auth);
  }
  const edges = [
    ['lookup-pipeline-string', [{ $lookup: { from: 'personas', pipeline: 'ab' } }]],
    ['lookup-pipeline-object', [{ $lookup: { from: 'personas', pipeline: { a: 1 } } }]],
    ['lookup-pipeline-null', [{ $lookup: { from: 'personas', pipeline: null } }]],
    ['lookup-string', [{ $lookup: 'personas' }]],
    ['lookup-array', [{ $lookup: ['personas'] }]],
    ['lookup-no-from', [{ $lookup: { as: 'x' } }]],
    ['out-everywhere', [{ $out: 'a' }, { $match: { $out: 'b', c: [{ $out: 'c' }, { d: 1 }] } }, [{ $out: 'e' }, 'f']]],
    ['proto-key', '{"__proto__":{"$oid":"6b083fe419b92523f89d6725"},"a":{"__proto__":{"$dte":"2026-01-01T00:00Z"}}}'],
    ['proto-key-pipeline', '[{"$match":{"__proto__":{"x":1},"statement.timestamp":"2026-01-01"}}]'],
    ['constructor-key', [{ $match: { constructor: { $oid: OIDS[0] }, 'statement.stored': '2026-01-01' } }]],
    ['invalid-json', '{oups'],
    ['json-number', '5'],
    ['scalar-null', null],
    ['scalar-number', 42],
    ['scalar-string-json', '"texte"'],
    ['nested-arrays', [[{ $match: { 'statement.timestamp': '2026-01-01' } }], [[{ $oid: OIDS[0] }]]]],
    ['empty-pipeline', []],
    ['empty-filter', {}],
  ];
  for (const [name, pipeline] of edges) for (const auth of [AUTH_INFOS[0], AUTH_INFOS[6]]) await add(`edge/${name}/${auth.name}`, pipeline, auth);
  for (const options of [null, undefined, 'x', { authInfo: null }]) {
    const input = { pipeline: [{ $match: { a: 1 } }], attributes: ATTRIBUTES };
    if (options !== undefined) input.options = options;
    else input.optionsUndefined = true;
    cases.push({ id: `options/${JSON.stringify(options) ?? 'undefined'}`, input, output: await call('parseQuery', input) });
  }
  write('parse-query', cases, 'parseQuery (lib/helpers/parseQuery.js) avec faux getScopeFilter et persona-service');
}

// --- Scopes -----------------------------------------------------------------------------------------

async function scopesCases() {
  rnd = mulberry32(SEED + 1);
  const cases = [];
  const add = async (id, input) => cases.push({ id, input, output: await call('scopes', input) });
  const constants = await call('scopes', { fn: 'constants' });
  cases.push({ id: 'constants', input: { fn: 'constants' }, output: constants });
  const org = constants.orgScopes;
  const extra = ['org/all/organisation/manage', 'site_admin', 'x/all/y', 'x/public/y', 'x/public/edit', 'x/public/view', 'inconnu'];
  for (const scope of [...org, 'org/all/organisation/manage', 'inconnu', 'constructor']) {
    await add(`dependencies/${scope}`, { fn: 'dependencies', scope });
    await add(`dependents/${scope}`, { fn: 'dependents', scope });
  }
  const customLists = [[...org, ...extra.slice(2, 6)], ['all', 'a/b/edit', 'a/b/view', 'a/all/b', 'a/public/b', 'all'], ['x/all/edit', 'x/public/edit', 'x/all/view', 'x/public/view']];
  for (const [i, list] of customLists.entries()) for (const scope of list) {
    await add(`dependencies-custom/${i}/${scope}`, { fn: 'dependencies', scopes: list, scope });
    await add(`dependents-custom/${i}/${scope}`, { fn: 'dependents', scopes: list, scope });
  }
  // generateNewScopes : sous-ensembles aléatoires (ordre compris), chaque scope, coché ou non.
  for (let n = 0; n < 900; n += 1) {
    const size = pick([0, 1, 2, 3, 5, 8, 9, 12, 20, org.length]);
    const old = [...org].sort(() => rnd() - 0.5).slice(0, size);
    if (chance(0.1)) old.push(pick(extra));
    if (chance(0.05)) old.push(old[0] ?? 'all');
    await add(`generate/${n}`, { fn: 'generateNewScopes', oldScopes: old, scope: pick(org), checked: chance(0.5) });
  }
  for (const scope of org) {
    await add(`generate-all/${scope}/uncheck`, { fn: 'generateNewScopes', oldScopes: org, scope, checked: false });
    await add(`generate-empty/${scope}/check`, { fn: 'generateNewScopes', oldScopes: [], scope, checked: true });
  }
  await add('group/default', { fn: 'groupScopes' });
  for (const [i, list] of customLists.entries()) await add(`group/${i}`, { fn: 'groupScopes', scopes: list });
  await add('group/proto', { fn: 'groupScopes', scopes: ['__proto__/x', 'a', '__proto__/y'] });
  for (const key of [...org, 'a/statementForwarding', 'a/foo_bar', 'a/ABCDef', 'a/x1y', 'a/1st', 'a/MANAGE', 'a/Manage-All', 'a/', '']) await add(`label/${key}`, { fn: 'getLabel', key });
  for (const key of [...Object.keys(constants.roleGroupNames), 'inconnu', 'org/all/x']) await add(`row-label/${key}`, { fn: 'getRowLabel', key });
  for (const value of [true, false, 'false', '', 0, null]) await add(`xapi/${JSON.stringify(value)}`, { fn: 'getXapiScopes', deleteStatementsEnabled: value });
  await add('xapi/default', { fn: 'getXapiScopes' });
  const scopeSets = [[], ['all'], ['site_admin'], ['org/all/persona/manage'], ['org/all/organisation/manage'], ['site_can_create_org'], ['observer', 'xapi/all'], 'all', null];
  for (const active of scopeSets) {
    for (const model of ['persona', 'store', 'user', 'organisation']) await add(`can-view/${model}/${JSON.stringify(active)}`, { fn: 'canViewModel', modelName: model, activeScopes: active });
    for (const restrict of [true, false, undefined, 0]) await add(`can-create/${JSON.stringify(active)}/${String(restrict)}`, { fn: 'canCreateOrganisations', activeScopes: active, options: restrict === undefined ? {} : { RESTRICT_CREATE_ORGANISATION: restrict } });
  }
  for (const value of ['true', 'TRUE', ' yes ', 'y', 't', '1', 'on', 'false', '0', '', 1, 0, 2, true, false, null]) await add(`boolean/${JSON.stringify(value)}`, { fn: 'boolean', value });
  const roleLists = [[[]], [['all']], [['a', 'b'], ['b', 'c']], [['org/all/persona/manage'], ['org/all/persona/manage', 'site_admin']], [['a', 'a'], ['a']]];
  for (const [i, roleScopes] of roleLists.entries()) for (const userScopes of [[], ['site_admin'], ['a', 'a']]) await add(`org-token/${i}/${userScopes.length}`, { fn: 'orgTokenScopes', roleScopes, userScopes });
  write('scopes', cases, 'scopes (lib/helpers/scopes.js, RoleForm, canViewModel, canCreateOrganisations, jwt.js)');
}

// --- Validation -------------------------------------------------------------------------------------

async function validationCases() {
  rnd = mulberry32(SEED + 2);
  const cases = [];
  const add = async (id, route, input) => cases.push({ id, input: { route, ...input }, output: await call(route, input) });
  const PASSWORDS = ['', 'a', 'abcdefgh', 'abcdefg1', '12345678', 'Motdepasse1', 'motdepasse', 'ÀÉÎõü1234', '😀😀😀😀😀😀😀a1', '😀1a', ' 1a      ', 'a1'.repeat(20), 'ABCDEFG1'];
  const SETTINGS = [
    {},
    { PASSWORD_MIN_LENGTH: 8, PASSWORD_REQUIRE_ALPHA: true, PASSWORD_REQUIRE_NUMBER: true },
    { PASSWORD_MIN_LENGTH: 0, PASSWORD_REQUIRE_ALPHA: false, PASSWORD_REQUIRE_NUMBER: false },
    { PASSWORD_MIN_LENGTH: '8', PASSWORD_REQUIRE_ALPHA: 1 },
    { PASSWORD_MIN_LENGTH: null, PASSWORD_REQUIRE_NUMBER: true },
    { PASSWORD_MIN_LENGTH: 12, PASSWORD_USE_CUSTOM_REGEX: true, PASSWORD_CUSTOM_REGEX: '^(?=.*[A-Z])(?=.*[0-9])', PASSWORD_CUSTOM_MESSAGE: 'Une majuscule et un chiffre' },
    { PASSWORD_MIN_LENGTH: 4, PASSWORD_USE_CUSTOM_REGEX: true, PASSWORD_CUSTOM_REGEX: '^[a-z]+$', PASSWORD_CUSTOM_MESSAGE: '' },
    { PASSWORD_MIN_LENGTH: 4, PASSWORD_USE_CUSTOM_REGEX: true, PASSWORD_CUSTOM_REGEX: '[', PASSWORD_REQUIRE_ALPHA: true, PASSWORD_REQUIRE_NUMBER: true },
    { PASSWORD_MIN_LENGTH: 4, PASSWORD_USE_CUSTOM_REGEX: true, PASSWORD_CUSTOM_REGEX: '', PASSWORD_REQUIRE_NUMBER: true },
    { PASSWORD_MIN_LENGTH: 4, PASSWORD_USE_CUSTOM_REGEX: false, PASSWORD_CUSTOM_REGEX: '^x$' },
    { PASSWORD_MIN_LENGTH: 4, PASSWORD_USE_CUSTOM_REGEX: true, PASSWORD_CUSTOM_REGEX: null },
    { PASSWORD_MIN_LENGTH: 6, PASSWORD_USE_CUSTOM_REGEX: true, PASSWORD_CUSTOM_REGEX: '\\d{3}', PASSWORD_CUSTOM_MESSAGE: null },
  ];
  for (const settings of SETTINGS) for (const value of PASSWORDS) await add(`util/${JSON.stringify(settings)}/${value}`, 'password', { fn: 'util', value, settings });
  for (const value of [12345678, null, ['abc']]) await add(`util-non-string/${JSON.stringify(value)}`, 'password', { fn: 'util', value, settings: SETTINGS[1] });
  const DEFAULTS = { PASSWORD_HISTORY_CHECK: true, PASSWORD_HISTORY_TOTAL: 3, PASSWORD_MIN_LENGTH: 8, PASSWORD_REQUIRE_ALPHA: true, PASSWORD_REQUIRE_NUMBER: true, PASSWORD_USE_CUSTOM_REGEX: false, PASSWORD_CUSTOM_REGEX: null, PASSWORD_CUSTOM_MESSAGE: null };
  const HISTORIES = [
    [],
    [{ date: '2026-01-01T00:00:00.000Z', hash: 'h:Ancien1234' }],
    [{ date: '2026-03-01T00:00:00.000Z', hash: 'h:Recent1234' }, { date: '2025-01-01T00:00:00.000Z', hash: 'h:Tres1234ancien' }, { date: '2026-02-01T00:00:00.000Z', hash: 'h:Moyen1234' }, { date: '2025-06-01T00:00:00.000Z', hash: 'h:Vieux1234' }],
    [{ hash: 'h:SansDate1234' }, { date: null, hash: 'h:DateNulle1234' }, { date: '2026-01-01T00:00:00.000Z', hash: 'h:Date1234' }],
  ];
  const HISTORY_VALUES = ['Ancien1234', 'Recent1234', 'Tres1234ancien', 'Moyen1234', 'Vieux1234', 'SansDate1234', 'DateNulle1234', 'Date1234', 'Nouveau1234', 'court', ''];
  const HISTORY_SETTINGS = [DEFAULTS, { ...DEFAULTS, PASSWORD_HISTORY_TOTAL: 1 }, { ...DEFAULTS, PASSWORD_HISTORY_TOTAL: 0 }, { ...DEFAULTS, PASSWORD_HISTORY_CHECK: false }, { ...DEFAULTS, PASSWORD_HISTORY_TOTAL: 10, PASSWORD_MIN_LENGTH: 20 }];
  for (const [h, history] of HISTORIES.entries()) for (const [s, settings] of HISTORY_SETTINGS.entries()) for (const value of HISTORY_VALUES) {
    await add(`validator/${h}/${s}/${value}`, 'password', { fn: 'validator', value, settings, history, modified: true });
  }
  await add('validator/not-modified', 'password', { fn: 'validator', value: 'x', settings: DEFAULTS, history: [], modified: false });
  // IFI
  const MBOXES = ['mailto:eleve@profenpoche.test', 'mailto:a.b+c@x.co', 'mailto:É@x.fr', 'eleve@profenpoche.test', 'mailto:a@b', 'mailto:a@b.c0', "mailto:o'neil`x@b.org", '', 5, null, undefined];
  const IRIS = ['https://profenpoche.test', 'urn:x', 'x:', 'é:x', 'pas une iri', '', 5, null, undefined, ['https://a.b']];
  const SHAS = ['abcde', 'ABCDEF0123', 'abcd', 'a'.repeat(40), 'a'.repeat(41), 'g1234', '', 7, null];
  const ACCOUNTS = [{ homePage: 'https://lms.test', name: 'e1' }, { homePage: 'https://lms.test' }, { name: 'e1' }, {}, { homePage: 'x', name: 5 }, { homePage: 'https://lms.test', name: '' },
    { homePage: 'https://lms.test', name: 'e1', extra: 1, autre: 2 }, { homePage: 5, name: null }, 'texte', null, [1], { constructor: 1, homePage: 'https://a.b', name: 'x' }];
  const ifis = [
    ...MBOXES.map((value) => ({ key: 'mbox', value })),
    ...IRIS.map((value) => ({ key: 'openid', value })),
    ...SHAS.map((value) => ({ key: 'mbox_sha1sum', value })),
    ...ACCOUNTS.map((value) => ({ key: 'account', value })),
    { key: 'inconnu', value: 'x' }, { value: 'x' }, {},
  ];
  for (const [i, ifi] of ifis.entries()) {
    for (const fn of ['validateIfi', 'default']) await add(`ifi/${fn}/${i}`, 'ifi', { fn, ifi, path: ['body', 'ifi'] });
  }
  for (const throwing of [null, 'chaine', 5]) await add(`ifi/throwing/${JSON.stringify(throwing)}`, 'ifi', { fn: 'validateIfi', ifi: throwing, path: ['ifi'] });
  for (let n = 0; n < 60; n += 1) {
    const list = sample(ifis, Math.floor(rnd() * 4));
    await add(`ifis/${n}`, 'ifi', { fn: 'validateIfis', ifi: list, path: ['ifi'] });
  }
  for (const value of ['pas une liste', { a: 1 }, undefined]) await add(`ifis/non-list/${JSON.stringify(value)}`, 'ifi', { fn: 'validateIfis', ifi: value, path: ['ifi'] });
  const UI = [
    ...MBOXES.filter((v) => v !== undefined).map((value) => ({ type: 'mbox', value })),
    ...IRIS.filter((v) => v !== undefined).map((value) => ({ type: 'openid', value })),
    ...['abc', '', 'x'].map((value) => ({ type: 'mbox_sha1sum', value })),
    ...ACCOUNTS.filter((v) => !(v && typeof v === 'object' && 'constructor' in v && Object.hasOwn(v, 'constructor'))).map((value) => ({ type: 'account', value })),
    { type: 'inconnu', value: 'x' }, { type: 'mbox_sha1sum', value: null },
  ];
  for (const [i, input] of UI.entries()) await add(`ui/${i}`, 'ifiUi', input);
  write('validation', cases, 'mots de passe (lib/utils/validators/User.js, lib/models/user.js) et IFI (lib/services/persona/validateIfi.js, rulr, xapi-validation, hasIdentifierValueErrors)');
}


// --- Schémas du front (preSave / reviver) -----------------------------------------------------------

// EJSON relaxed → JSON de l'API : ObjectId → chaîne hexadécimale, Date → chaîne ISO.
const apiJson = (value) => {
  if (Array.isArray(value)) return value.map(apiJson);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$oid') return value.$oid;
    if (keys.length === 1 && keys[0] === '$date') {
      const d = value.$date;
      return new Date(typeof d === 'object' ? Number(d.$numberLong) : d).toISOString();
    }
    return Object.fromEntries(keys.map((k) => [k, apiJson(value[k])]));
  }
  return value;
};

// Valeurs sensibles (empreintes, secrets de test) remplacées : les fixtures sont versionnées.
const SENSITIVE = /password|secret|token|hash|basic_key|basicUsername|filterJwtSecret|apiKey/i;
const scrub = (value, key = '') => {
  if (Array.isArray(value)) return value.map((item) => scrub(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  return SENSITIVE.test(key) && typeof value === 'string' ? 'masqué' : value;
};

const COLLECTIONS = {
  user: ['users', 5], lrs: ['lrs', 2], organisation: ['organisations', 3], statement: ['statements', 8], visualisation: ['visualisations', 30],
  persona: ['personas', 8], query: ['queries', 2], personaAttribute: ['personaAttributes', 12], personaIdentifier: ['personaIdentifiers', 12],
  client: ['client', 7], dashboard: ['dashboards', 6], export: ['exports', 1], download: ['downloads', 1], querybuildercache: ['queryBuilderCaches', 8],
  querybuildercachevalue: ['queryBuilderCacheValues', 8], role: ['role', 8], statementForwarding: ['statementForwarding', 4],
  personasImport: ['personasImports', 1], siteSettings: ['siteSettings', 1],
};

function readCollections() {
  const spec = JSON.stringify(Object.values(COLLECTIONS));
  const script = `const out = {}; for (const [c, n] of ${spec}) out[c] = db.getCollection(c).find().sort({ _id: 1 }).limit(n).toArray(); print(EJSON.stringify(out, { relaxed: true }))`;
  const raw = execFileSync('mongosh', ['--quiet', MONGO_URL, '--eval', script], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return scrub(apiJson(JSON.parse(raw)));
}

const big = (prefix) => Object.fromEntries(['Aa', 'BB', 'zeta', 'alpha', 'name', 'owner', 'organisation', 'createdAt', 'updatedAt', 'z9'].map((k, i) => [k, `${prefix}${i}`]));

const EDGE_DOCS = {
  user: [
    { _id: 'u1', organisationSettings: [{ organisation: 'o1', filter: '{"a":1,"b":{"$dte":"2026-01-01T00:00Z"}}', roles: ['r1'] }, { organisation: 'o2', filter: 'pas du json' }, { organisation: 'o3' }, { filter: 5 }, { filter: '{}', scopes: [] }] },
    { organisationSettings: { a: { filter: '{"x":1}' }, b: { filter: '[1,2]' } } },
    { organisationSettings: [{ filter: { deja: 'objet' } }] },
    { nested: { organisationSettings: [{ filter: '{"n":1}' }] }, ...big('u') },
    { organisationSettings: ['texte'] },
    { organisationSettings: [] },
  ],
  statementForwarding: [
    { _id: 's1', query: '{"statement.verb.id":"x","$and":[{"a":1}]}', configuration: { url: 'https://x.test', headers: '{"h":1}', liste: [1, 2] }, tags: ['a', 'b'] },
    { query: 'pas du json' },
    { query: { deja: 'objet' } },
    { query: '[1,2]', autre: { query: '{"imbrique":true}' } },
    big('sf'),
  ],
  query: [{ _id: 'q1', conditions: '{"a":1}', name: 'x' }, { conditions: { a: 1 } }],
  dashboard: [
    { _id: 'd1', title: 'T', widgets: [{ _id: 'w1', visualisation: 'v1', x: 0, y: 0, w: 6, h: 4 }], shareable: [{ _id: 's1', filter: '{"a":1}', title: 'p' }, { _id: 's2', filter: 'pas du json', title: 'q' }, { _id: 's3', title: 'sans filtre' }, { _id: 's4', filter: { deja: 1 } }] },
    { widgets: { a: { _id: 'w1' }, b: { _id: 'w2' } }, shareable: [] },
    { filter: '{"racine":1}', widgets: [] },
    { shareable: [{ filter: '[1]' }, { filter: 'null' }, { filter: '5' }] },
    big('d'),
  ],
  export: [
    { _id: 'e1', name: 'Export', projections: ['{"statement.actor":1,"statement.verb":1,"z":{"b":1,"a":2}}', 'pas du json', '[["a",1],["b",2]]', 'null', '{"__proto__":{"x":1},"k":1}'], rawMode: false },
    { projections: { p1: '{"a":1}', p2: '{"b":2}' } },
    { projections: ['[1]'] },
    { projections: ['"abc"'] },
    { projections: ['5'] },
    { projections: [], tags: ['b', 'a', 'b', 1, 1, true, null, { x: 1 }, { x: 1 }, [1], [1], 'c', 'd', 'e', 'f', 'g', 'h', 'i'], nested: { list: [3, 2, 1, 2, 3] } },
    { downloads: [{ _id: 'dl1', url: 'x' }, { _id: 'dl1', url: 'x' }, { _id: 'dl2' }] },
  ],
  personaIdentifier: [
    { id: 'pi1', ifi: { key: 'mbox', value: 'mailto:a@b.c' }, persona: 'p1' },
    { _id: 'pi2', id: 'autre', ifi: { key: 'account', value: { homePage: 'https://x', name: 'n' } } },
    { liste: [{ a: 1, id: 'premier' }, { b: 2, id: 'second' }, [3, 4]], tableaux: [[1, 2], { id: 'x' }] },
  ],
  personaAttribute: [{ id: 'pa1', key: 'classe', value: '4eB' }, { _id: '', id: 'pa2' }, { value: [{ id: 'v' }, { id: 'w' }] }],
  client: [{ _id: 'c1', authority: '{"objectType":"Agent","name":"x","mbox":"mailto:a@b.c"}', scopes: ['all'] }],
  visualisation: [
    { _id: 'v1', type: 'LEADERBOARD', filters: ['{"$match":{}}', 'pas du json'], axes: '{"group":{"optionKey":"verb"}}', axesgroup: '{"optionKey":"people"}', axesvalue: 'null', axesxQuery: '{"$match":{"a":1}}' },
    { _id: 'v2', filters: { a: '{"$match":{"x":1}}' } },
  ],
  lrs: [{ ...big('l'), title: 'Store', statementCount: 5, constructor: 'brut' }, { a: { constructor: 1, b: [1, 2] }, c: [{ d: 1 }] }, JSON.parse('{"__proto__":{"x":1},"a":1}')],
  role: [{ _id: 'r1', title: 'Rôle', scopes: ['all', 'org/all/persona/manage'], owner: 'u1', organisation: 'o1' }],
};

const EDGE_MODELS = {
  user: [
    { organisationSettings: [{ organisation: 'o1', filter: { a: 1, b: { $dte: '2026-01-01T00:00Z' } } }, { filter: {} }, { organisation: 'o2' }, { filter: 'deja-texte' }, { filter: [1] }, { filter: [] }] },
    { name: 'sans réglages' },
    { organisationSettings: { a: { filter: { x: 1 } } } },
    { organisationSettings: [{ filter: null }] },
    { organisationSettings: ['texte'] },
    { organisationSettings: [['liste']] },
    { organisationSettings: [{ filter: big('f') }], ...big('u') },
  ],
  statementForwarding: [{ query: { a: 1, $and: [{ b: 2 }] } }, { name: 'sans requête' }, { query: 'texte' }, { query: [1, 2] }, { query: big('q') }],
  query: [{ conditions: { a: 1 } }, { conditions: {} }, { name: 'x' }, { conditions: 'texte' }, { conditions: null }, { conditions: [] }],
  client: [{ authority: { objectType: 'Agent', mbox: 'mailto:a@b.c' } }, { authority: 'texte' }, { name: 'sans' }, { authority: [1] }, { authority: null }],
  dashboard: [
    { shareable: [{ filter: { a: 1 } }, { filter: {} }, { title: 'x' }, { filter: 'texte' }] },
    { shareable: null }, { shareable: '' }, { title: 'sans' }, { shareable: [] }, { shareable: { a: { filter: { x: 1 } } } }, { shareable: ['texte'] }, { shareable: [{ filter: null }] },
  ],
  export: [{ projections: [{ a: 1, b: { c: 2 } }, []] }, { name: 'sans' }, { projections: ['texte'] }, { projections: { p: { a: 1 } } }],
  visualisation: [
    { type: 'PIE', filters: [{ $match: { a: 1 }, label: 'x' }], axesgroup: { optionKey: 'verb' }, axesvalue: null, axesxQuery: '', axesoperator: 'count', axes: { old: 1 } },
    { type: 'COUNTER' },
    { filters: 'texte' },
    { axes: 'texte' },
    { axesgroup: 'texte' },
    { axesgroup: 0, axesvalue: false, axesquery: { $match: {} }, ...big('v') },
  ],
  lrs: [{ title: 'x', ...big('l') }, { constructor: 1, a: 2 }],
};

async function schemaCases() {
  rnd = mulberry32(SEED + 3);
  const cases = [];
  const add = async (id, route, input) => cases.push({ id, input: { route, ...input }, output: await call(route, input) });
  const db = readCollections();
  const names = Object.keys(COLLECTIONS);
  for (const schema of names) {
    const [collection] = COLLECTIONS[schema];
    for (const [i, doc] of (db[collection] ?? []).entries()) {
      await add(`revive/${schema}/real/${i}`, 'revive', { schema, doc });
      const revived = cases.at(-1).output;
      if (!revived || !revived.$$thrown) await add(`presave/${schema}/real/${i}`, 'presave', { schema, props: untag(revived) });
    }
  }
  for (const [schema, docs] of Object.entries(EDGE_DOCS)) {
    for (const [i, doc] of docs.entries()) {
      await add(`revive/${schema}/edge/${i}`, 'revive', { schema, doc });
      // Même document avec d'autres schémas (reviver par défaut, revivers spécifiques sur des données inattendues).
      for (const other of ['lrs', 'user', 'dashboard', 'export', 'statementForwarding', 'personaIdentifier', 'visualisation']) {
        if (other !== schema) await add(`revive/${other}/from-${schema}/${i}`, 'revive', { schema: other, doc });
      }
    }
  }
  for (const [schema, models] of Object.entries(EDGE_MODELS)) {
    for (const [i, props] of models.entries()) {
      await add(`presave/${schema}/edge/${i}`, 'presave', { schema, props });
      for (const other of ['lrs', 'user', 'query', 'client', 'dashboard', 'export', 'statementForwarding', 'visualisation']) {
        if (other !== schema) await add(`presave/${other}/from-${schema}/${i}`, 'presave', { schema: other, props });
      }
    }
  }
  for (const route of ['revive', 'presave']) await add(`${route}/inconnu`, route, { schema: 'inconnu', doc: {}, props: {} });
  write('schemas', cases, 'preSave et reviver des schémas du front (ui/src/utils/schemas.js), documents réels de la base legacy et cas limites');
}

// Sortie étiquetée → valeur JSON (pour réinjecter un modèle ravivé dans preSave).
const untag = (value) => {
  if (Array.isArray(value)) return value.map(untag);
  if (value && typeof value === 'object') {
    if (value.$$undefined) return undefined;
    return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '$$proto').map(([k, v]) => [k, untag(v)]));
  }
  return value;
};

// --- Utilitaires du query builder -------------------------------------------------------------------

const qbComment = (label, ...path) => JSON.stringify({ criterionLabel: label, criteriaPath: path });
const QB_CRITERIA = [
  (l) => ({ $comment: qbComment(l, 'statement', 'verb'), 'statement.verb.id': { $in: ['http://adlnet.gov/expapi/verbs/passed', 'http://adlnet.gov/expapi/verbs/failed'] } }),
  (l) => ({ $comment: qbComment(l, 'statement', 'verb'), 'statement.verb.id': { $nin: ['http://adlnet.gov/expapi/verbs/voided'] } }),
  (l) => ({ $comment: qbComment(l, 'person'), 'person._id': { $in: [{ $oid: '6b0847194f911ed420997f15' }] } }),
  (l) => ({ $comment: qbComment(l, 'statement', 'object'), 'statement.object.id': { $in: [] } }),
  (l) => ({ $comment: qbComment(l, 'statement', 'actor'), $or: [{ 'statement.actor.mbox': 'mailto:a@b.c' }] }),
  (l) => ({ $comment: qbComment(l, 'statement', 'actor'), $nor: [{ 'statement.actor.mbox': 'mailto:x@y.z' }, { 'statement.actor.account.name': 'n' }] }),
  (l) => ({ $comment: qbComment(l, 'statement', 'context', 'platform'), $or: [] }),
  (l) => ({ $comment: qbComment(l, 'timestamp'), timestamp: { $gt: { $dte: '2026-01-01T00:00+01:00' } } }),
  (l) => ({ $comment: qbComment(l, 'statement', 'result', 'score', 'scaled'), 'statement.result.score.scaled': { $gte: 0.5 } }),
  (l) => ({ $comment: qbComment(l, 'persona', 'import', 'classe'), 'person._id': { $personaIdent: { key: 'persona.import.classe', value: '4eB' } } }),
  () => ({ $comment: 'statement.verb', 'statement.verb.id': { $in: ['http://adlnet.gov/expapi/verbs/completed'] } }),
  () => ({ $comment: 'statement.context.platform', $or: [{ 'statement.context.platform': 'Stream' }] }),
];
const LABELS = ['A', 'B', 'C', 'D', 'Z', 'AA', 'AZ', 'ZZ', 'b', 'A'];

const qbQuery = () => {
  const n = pick([0, 1, 2, 3, 4, 6, 9, 12]);
  const list = Array.from({ length: n }, (_, i) => pick(QB_CRITERIA)(chance(0.15) ? pick(LABELS) : LABELS[i % 8]));
  const r = rnd();
  if (r < 0.6) return n === 0 ? {} : { $and: list };
  if (r < 0.7) return { $and: list, $comment2: 'x' };
  if (r < 0.8) return { $or: [{ $and: list }, { autre: 1 }] };
  if (r < 0.88) return { $and: [...list, { scalaire: 5 }] };
  if (r < 0.94) return { a: { $and: list }, b: 7, c: { $and: list.slice(0, 1) } };
  return list;
};

const KEY_PATHS = [['person'], ['statement', 'verb'], ['statement', 'object'], ['statement', 'actor'], ['statement', 'context', 'platform'], ['timestamp']];
const TOKENS = {
  'person': [{ 'person._id': { $oid: '6b0847194f911ed420997f15' } }, { 'person._id': { $oid: '6b0847194f911ed420997f99' } }],
  'statement.verb': [{ 'statement.verb.id': 'http://adlnet.gov/expapi/verbs/passed' }, { 'statement.verb.id': 'http://adlnet.gov/expapi/verbs/attempted' }],
  'statement.object': [{ 'statement.object.id': 'https://profenpoche.test/activite/1' }],
  'statement.actor': [{ 'statement.actor.mbox': 'mailto:a@b.c' }, { 'statement.actor.mbox': 'mailto:nouveau@b.c', 'statement.actor.name': 'N' }],
  'statement.context.platform': [{ 'statement.context.platform': 'Curatr' }],
  timestamp: [{ timestamp: { $gt: { $dte: '2026-01-01T00:00Z' } } }],
};

async function queriesCases() {
  rnd = mulberry32(SEED + 4);
  const cases = [];
  const add = async (id, input) => cases.push({ id, input, output: await call('queries', input) });
  const queries = [
    {}, { $and: [] },
    { $and: QB_CRITERIA.map((make, i) => make(LABELS[i % 8])) },
    { $and: [QB_CRITERIA[0]('A'), QB_CRITERIA[0]('A')] },
    { $and: [{ $comment: '{oups', a: 1 }] },
    { $and: [{ $comment: 5, a: 1 }] },
    { $and: [{ $comment: null, a: 1 }] },
    { $and: [{ $comment: '{"criterionLabel":"A"}', a: 1 }] },
    { $and: [{ $comment: '{"criterionLabel":"A","criteriaPath":"statement"}', a: 1 }] },
    { $and: [{ $comment: '{"criterionLabel":5,"criteriaPath":["x"]}', a: 1 }, { $comment: 'ancien.format', b: 1 }] },
    { $and: [{ $comment: '{"criterionLabel":"Z","criteriaPath":["x"]}', a: 1 }, { $comment: 'ancien', b: 1 }] },
    { $and: [{ $comment: '{"criterionLabel":"AZ","criteriaPath":["x"]}', a: 1 }, { $comment: 'ancien', b: 1 }] },
    { $and: [{ $comment: '{"criterionLabel":"ZZ","criteriaPath":["x"]}', a: 1 }, { $comment: 'ancien', b: 1 }] },
    { $and: [{ $comment: '{"criterionLabel":"","criteriaPath":["x"]}', a: 1 }, { $comment: 'ancien', b: 1 }] },
    { $and: [{ $comment: ['liste'], a: 1 }] },
    { $comment: qbComment('A', 'racine'), a: 1 },
    'scalaire', 5, null, [1, 2],
    { a: [{ b: { $dte: 'x' } }] }, { a: [{ b: { sdte: 'x' } }] },
  ];
  for (let n = 0; n < 220; n += 1) queries.push(qbQuery());
  for (const [i, query] of queries.entries()) {
    await add(`criteria/${i}`, { fn: 'getCriteria', query });
    await add(`strings/${i}`, { fn: 'queryToStringList', query });
    await add(`has-dte/${i}`, { fn: 'has$dte', query });
    const criteria = cases.at(-3).output;
    if (Array.isArray(criteria)) {
      for (const [k, [key]] of criteria.entries()) if (k < 3) await add(`delete/${i}/${k}`, { fn: 'deleteCriterion', query, key });
      await add(`delete/${i}/inconnu`, { fn: 'deleteCriterion', query, key: { criterionLabel: 'ZZZ', criteriaPath: ['x'] } });
    }
    for (const keyPath of KEY_PATHS) {
      if (!chance(0.5)) continue;
      const token = pick(TOKENS[keyPath.join('.')]);
      await add(`token/${i}/${keyPath.join('.')}`, { fn: 'addTokenToQuery', query, keyPath, token });
    }
    if (chance(0.3)) await add(`section/${i}`, { fn: 'addCriterionFromSection', query, criterion: { 'statement.verb.id': { $in: ['x'] } }, section: pick([{ keyPath: ['statement', 'verb'] }, {}, { keyPath: ['a'], title: 't' }]) });
  }
  // Jetons déjà présents (toujours ajoutés, List.has teste un indice) et jetons vides.
  const base = { $and: [QB_CRITERIA[0]('A'), QB_CRITERIA[4]('B'), QB_CRITERIA[2]('C')] };
  for (const [keyPath, token] of [[['statement', 'verb'], { 'statement.verb.id': 'http://adlnet.gov/expapi/verbs/passed' }], [['statement', 'actor'], { 'statement.actor.mbox': 'mailto:a@b.c' }],
    [['person'], { 'person._id': { $oid: '6b0847194f911ed420997f15' } }], [['person'], {}], [['person'], { autre: 1 }], [['statement', 'verb'], { 'statement.verb.id': 0 }]]) {
    await add(`token-edge/${keyPath.join('.')}/${JSON.stringify(token)}`, { fn: 'addTokenToQuery', query: base, keyPath, token });
  }
  write('queries', cases, 'utilitaires du query builder (ui/src/utils/queries/index.js, has$dte.js)');
}

const CATEGORIES = { 'parse-query': parseQueryCases, scopes: scopesCases, validation: validationCases, schemas: schemaCases, queries: queriesCases };
for (const [name, run] of Object.entries(CATEGORIES)) {
  if (only.length && !only.includes(name)) continue;
  await run();
}
