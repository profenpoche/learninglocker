#!/usr/bin/env node
// Oracle des pipelines d'agrégation des visualisations (lot 4).
//
// Produit les cas de référence de packages/shared (test pipelines.oracle.test.ts) : pour chaque cas,
// l'entrée { visualisation (document stocké), orgTimezone, now, dashboardFilter? } et la sortie du
// VRAI code du front React (ui/src/utils/visualisations, via la route POST /pipelines du service
// tools/seed/legacy/presave-server.js, qui tourne dans l'image legacy).
//
// Cas : les visualisations réelles du jeu de test (lecture seule de la base legacy), les 13 modèles,
// puis des cas générés de façon déterministe (graine fixe) qui couvrent toutes les branches du code.
//
// Relancer (sur la VM, depuis ~/legacy, après copie de tools/oracle → ~/legacy/oracle) :
//   ./oracle/pipelines.sh                        # démarre le service, génère, arrête le service
//   scp -P 2222 sam@localhost:legacy/oracle/out/visualisation-pipelines.json.gz \
//       packages/shared/test/fixtures/           # depuis le dépôt, sur l'hôte
// Ou directement, service presave déjà lancé :
//   PRESAVE=http://127.0.0.1:18091 node oracle/pipelines.mjs oracle/out/visualisation-pipelines.json.gz
//
// Variables : PRESAVE (défaut http://127.0.0.1:18091), MONGO_URL (défaut
// mongodb://127.0.0.1:27018/learninglocker_v2 ; lecture seule, via mongosh), SEED (défaut 20261126).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const PRESAVE = process.env.PRESAVE ?? 'http://127.0.0.1:18091';
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/learninglocker_v2';
const SEED = Number(process.env.SEED ?? 20261126);
const out = resolve(process.argv[2] ?? 'oracle/out/visualisation-pipelines.json.gz');

// --- Aléa déterministe ---------------------------------------------------------------------------

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = mulberry32(SEED);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
let idCounter = 0;
const objectId = () => (0x6b100000 + idCounter++).toString(16).padStart(8, '0') + '4f911e0000000000';

// --- Service presave -------------------------------------------------------------------------------

async function post(path, body) {
  const res = await fetch(`${PRESAVE}${path}`, { method: 'POST', body: JSON.stringify(body) });
  const json = await res.json();
  return { ok: res.ok, json };
}

// Modèle « front » → document stocké, par le vrai preSave du schéma visualisation.
async function presave(model) {
  const { ok, json } = await post('/presave', { schema: 'visualisation', props: model });
  if (!ok) throw new Error(`presave : ${json.error}`);
  return json;
}

// --- Visualisations réelles (lecture seule) ----------------------------------------------------------

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

function readDatabase() {
  const script = `print(EJSON.stringify({
    visualisations: db.visualisations.find().sort({ _id: 1 }).toArray(),
    organisations: db.organisations.find({}, { timezone: 1 }).toArray(),
    dashboards: db.dashboards.find({}, { shareable: 1 }).toArray(),
  }, { relaxed: true }))`;
  const raw = execFileSync('mongosh', ['--quiet', MONGO_URL, '--eval', script], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return apiJson(JSON.parse(raw));
}

// --- Domaines de valeurs ------------------------------------------------------------------------------

const CHART_TYPES = ['LEADERBOARD', 'PIE', 'STATEMENTS', 'FREQUENCY', 'TEMPLATE_ACTIVITY_OVER_TIME', 'TEMPLATE_MOST_ACTIVE_PEOPLE',
  'TEMPLATE_MOST_POPULAR_ACTIVITIES', 'TEMPLATE_MOST_POPULAR_VERBS', 'TEMPLATE_WEEKDAYS_ACTIVITY',
  'TEMPLATE_STREAM_LEARNER_INTERACTIONS_BY_DATE_AND_VERB', 'TEMPLATE_STREAM_USER_ENGAGEMENT_LEADERBOARD',
  'TEMPLATE_STREAM_PROPORTION_OF_SOCIAL_INTERACTIONS', 'TEMPLATE_STREAM_ACTIVITIES_WITH_MOST_COMMENTS', 'TEMPLATE_LEARNING_EXPERIENCE_TYPE'];
const XVSY_TYPES = ['XVSY', 'TEMPLATE_STREAM_INTERACTIONS_VS_ENGAGEMENT'];
const COUNTER_TYPES = ['COUNTER', 'TEMPLATE_LAST_7_DAYS_STATEMENTS', 'TEMPLATE_STREAM_COMMENT_COUNT'];
const ABSENT = Symbol('absent');
const OTHER_TYPES = [ABSENT, 'JOURNEY_PROGRESS', '', null];

const OPERATORS = ['uniqueCount', 'count', 'average', 'max', 'min', 'uniqueAverage', 'uniqueMax', 'uniqueMin', ABSENT, 'sum', null];
const PERIODS = ['TODAY', 'LAST_24_HOURS', 'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_2_MONTHS', 'LAST_6_MONTHS', 'LAST_1_YEAR', 'LAST_2_YEARS', ABSENT, 'LAST_3_DAYS', null];

const EXT_APPAREIL = 'statement.context.extensions.https://profenpoche&46;test/xapi/extensions/appareil';
const EXT_TEMPS = 'statement.result.extensions.http://profenpoche&46;test/xapi/extensions/temps&46;secondes';
// optionKey non textuels : le front les convertit par toString() (« Map { … } », « List [ … ] »).
// Un objet avec une clé « constructor » n'est pas converti par fromJS (objet « brut »).
const OBJECT_KEYS = [{ a: 1, b: [1, 'x', null, {}] }, ['x', 1], {}, [], { constructor: 1 }, { constructor: 1, toString: 'x' }];
const VALUE_KEYS = ['statements', 'people', 'activities', 'verb', 'type', 'scaled', 'raw', 'steps', 'response', 'statement',
  EXT_TEMPS, EXT_APPAREIL, 'persona.import.classe', 'timestamp', 'hour', '', 'constructor', 'toString', '__proto__', 42, null, ...OBJECT_KEYS];
// Axe « value » : absent, option {optionKey, searchString}, ou valeur stockée inhabituelle.
const valueAxis = (key) => (key === ABSENT ? ABSENT : { optionKey: key, searchString: typeof key === 'string' ? key : 'x' });
// Axe stocké sous forme d'objet brut : getIn le traverse (sans clé « get ») ou échoue (avec).
const RAW_AXES = [{ stored: '{"constructor":1,"optionKey":"verb"}' }, { stored: '{"constructor":1,"get":"x","optionKey":"verb"}' }];
const VALUE_AXES = [ABSENT, ...VALUE_KEYS.map(valueAxis), { stored: 'null' }, { stored: '{}' }, { stored: '"statements"' }, { stored: '[]' }, ...RAW_AXES];

const CONTEXT_ACTIVITIES = ['grouping', 'category', 'other', 'parent'].map((t) => `statement.context.contextActivities.${t}`);
const GROUP_KEYS = ['date', 'minute', 'hour', 'weekday', 'month', 'year', 'people', 'activities', 'verb', 'type', 'raw', 'response',
  'persona.import.classe', 'persona.import.a.b', 'persona.import.', ...CONTEXT_ACTIVITIES, 'statement.context.contextActivities.foo',
  'statement.context.contextActivities.grouping.id', EXT_APPAREIL, 'statement.actor.name', 'statements', 'constructor', 'toString', ''];
const DEFINITION_TYPES = [ABSENT, 'http://id.tincanapi.com/activitytype/school-assignment', '', 42, null];
const groupAxis = (key, definitionType = ABSENT) => {
  if (key === ABSENT) return ABSENT;
  const axis = { optionKey: key, searchString: key };
  if (definitionType !== ABSENT) axis.contextActivityDefinitionType = definitionType;
  return axis;
};
const GROUP_AXES_ODD = [{ stored: 'null' }, { stored: '{}' }, { stored: '[]' }, { optionKey: 5, searchString: '5' }, ...RAW_AXES,
  ...OBJECT_KEYS.map((key) => ({ optionKey: key, searchString: 'x' }))];

const TIMEZONES = ['UTC', 'Europe/Paris', 'America/New_York', 'Asia/Kolkata', '+05:30', '-03:00', '+05:00', '+14:00', '-12:00',
  'Etc/GMT-3', 'europe/paris', 'US/Pacific-New', 'Australia/Sydney', 'Asia/Tokyo', 'Europe/London', 'Mars/Phobos', ABSENT, null, ''];
const ORG_TIMEZONES = [ABSENT, 'Europe/Paris', 'America/New_York', 'UTC', '+05:30', 'Asia/Kolkata', '-03:00', ''];

const NOWS = [
  '2026-11-26T14:19:37.123Z', // date de référence du jeu de test, secondes et millisecondes
  '2026-03-29T00:59:30.000Z', '2026-03-29T01:00:00.000Z', '2026-03-29T01:30:59.999Z', // Paris : passage à l'heure d'été
  '2026-10-25T00:59:00.000Z', '2026-10-25T01:00:00.000Z', // Paris : retour à l'heure d'hiver
  '2026-03-08T06:59:59.000Z', '2026-03-08T07:00:00.000Z', '2026-11-01T05:59:00.000Z', '2026-11-01T06:00:00.000Z', // New York
  '2026-04-04T15:59:00.000Z', '2026-10-03T16:00:00.000Z', // Sydney
  '2026-03-31T12:00:00.000Z', '2026-05-31T23:59:59.999Z', '2026-08-31T22:30:00.000Z', '2026-12-31T12:00:00.000Z', // fins de mois
  '2024-02-29T12:00:00.000Z', '2024-02-29T23:30:00.000Z', '2028-02-29T00:00:00.000Z', // 29 février
  '2026-01-01T00:00:00.000Z', '2025-12-31T23:59:59.999Z', '2027-12-31T23:00:00.000Z', // minuit UTC, fin d'année
  '2026-06-14T18:29:59.000Z', '2026-06-14T18:30:00.000Z', // minuit à Kolkata
  '2026-04-30T22:00:00.000Z', '2026-07-15T03:59:00.000Z',
];

// --- Séries (filters) ------------------------------------------------------------------------------

const comment = (label, ...path) => JSON.stringify({ criterionLabel: label, criteriaPath: path });
const VERB = (v) => `http://adlnet.gov/expapi/verbs/${v}`;
const DTE_VALUES = ['2019-02-03T09:00+01:00', '2018-03-25T00:00', '2026-03-29T02:30Z', '2026-10-25T02:30:00.000Z', '2016-11-04T00:00-07:30',
  '2024-02-29T23:59:59+05:30', '2026-07-01', '2026-12-31T23:59:59.999-12:00', '2026-11-01T01:30-04:00', 'pas une date', ''];
const bigObject = (prefix) => Object.fromEntries(['Aa', 'BB', 'statement.verb.id', 'timestamp', 'stored', 'lrs_id', 'voided', 'person._id',
  'statement.object.id', 'metadata.x', 'AaAa', 'BBBB', 'z'].map((k, i) => [k, i === 3 ? { $gte: { $dte: '2026-01-02T03:04+02:00' } } : `${prefix}${i}`]));

const FILTERS = {
  empty: { $match: {} },
  noMatch: {},
  labelOnly: { label: 'Série', color: '#F5AB36' },
  verb: { label: 'Réussites', color: '#36D7B7', $match: { $and: [{ $comment: comment('A', 'statement', 'verb'), 'statement.verb.id': { $in: [VERB('passed')] } }] } },
  single: { $match: { $comment: comment('A', 'statement', 'verb'), 'statement.verb.id': { $nin: [VERB('failed')] } } },
  builder: {
    $match: {
      $and: [
        { $comment: comment('A', 'person'), 'person._id': { $in: [{ $oid: '6b0847194f911ed420997f15' }] } },
        { $comment: comment('B', 'statement', 'actor'), $or: [{ 'statement.actor.mbox': 'mailto:eleve1@profenpoche.test' }, { 'statement.actor.account.name': 'e2' }] },
        { $comment: comment('C', 'timestamp'), timestamp: { $gt: { $dte: '2026-11-01T09:00+01:00' } } },
        { $comment: comment('D', 'stored'), stored: { $lte: { $dte: '2026-11-20T23:59Z' } } },
        { $comment: comment('E', 'statement', 'result', 'score', 'scaled'), 'statement.result.score.scaled': { $gte: 0.5 } },
        { $comment: comment('F', 'persona', 'import', 'classe'), 'person._id': { $personaIdent: { key: 'persona.import.classe', value: '4eB' } } },
        { $comment: comment('G', 'statement', 'context', 'extensions'), [EXT_APPAREIL]: { $in: ['tablette'] } },
        { $comment: comment('H', 'lrs_id'), lrs_id: { $nin: [{ $oid: '6b083feb4f911eb3ee997f07' }] } },
        { $comment: comment('I', 'statement', 'actor'), $nor: [{ 'statement.actor.mbox': 'mailto:prof@profenpoche.test' }] },
      ],
    },
  },
  oldComment: { $match: { $and: [{ $comment: 'statement.verb', 'statement.verb.id': { $in: [VERB('completed')] } }] } },
  dte: (value) => ({ $match: { $and: [{ $comment: comment('A', 'timestamp'), timestamp: { $gte: { $dte: value } } }, { stored: { $lt: { $dte: value } } }] } }),
  dteOdd: { $match: { a: { $dte: 12345 }, b: { $dte: null }, c: { $dte: { $dte: '2026-01-01T00:00Z' } }, d: [{ $dte: '2026-06-01T12:00+02:00' }, [{ $dte: '2026-06-01T12:00' }]] } },
  big: { $match: { ...bigObject('v'), nested: { $and: [bigObject('w')] } } },
  andEmpty: { $match: { $and: [{}] } },
  matchList: { $match: [] },
  matchString: { $match: 'texte' },
  matchZero: { $match: 0 },
  matchFalse: { $match: false },
  rawConstructor: { $match: { constructor: 'x', timestamp: { $gte: { $dte: '2026-01-01T00:00Z' } } } },
  rawSizeZero: { $match: { size: 0, constructor: 1 } },
  nestedConstructor: { $match: { $and: [{ constructor: { $dte: '2026-01-01T00:00Z' } }, { timestamp: { $dte: '2026-01-01T00:00Z' } }] } },
  numericKeys: { $match: { 10: 'a', 2: 'b', x: { $dte: '2026-05-05T05:05+05:00' }, 1: 'c' } },
  bigNumericKeys: { $match: Object.fromEntries(['k', 'j', '3', 'i', 'h', '12', 'g', 'f', 'e', 'd', '0', 'c'].map((k) => [k, k])) },
  getKey: { $match: { get: 'x', $and: [] } },
};
const FILTER_KEYS = Object.keys(FILTERS).filter((k) => k !== 'dte');
// Chaînes stockées inhabituelles (séries illisibles ou scalaires).
const RAW_FILTERS = { invalidJson: 'pas du json', jsonNumber: '5', jsonString: '"chaine"', jsonList: '[1,2]' };
// Séries qui font échouer le front d'origine.
const THROWING_FILTERS = { matchNull: '{"$match":null}', jsonNull: 'null' };

const filterString = (name) => {
  if (name.startsWith('dte:')) return JSON.stringify(FILTERS.dte(name.slice(4)));
  if (name in RAW_FILTERS) return RAW_FILTERS[name];
  if (name in THROWING_FILTERS) return THROWING_FILTERS[name];
  return JSON.stringify(FILTERS[name]);
};
const randomFilterName = () => (chance(0.25) ? `dte:${pick(DTE_VALUES)}` : chance(0.08) ? pick(Object.keys(RAW_FILTERS)) : pick(FILTER_KEYS));
const randomFilters = () => {
  const r = rnd();
  const count = r < 0.05 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.92 ? 3 : 5;
  return Array.from({ length: count }, randomFilterName);
};

// --- Filtres de partage de dashboard ---------------------------------------------------------------

const DASHBOARD_FILTERS = {
  none: ABSENT,
  empty: {},
  platform: { $and: [{ $comment: comment('A', 'statement', 'context', 'platform'), 'statement.context.platform': { $in: ['Profenpoche App'] } }] },
  dte: { $and: [{ $comment: comment('A', 'timestamp'), timestamp: { $gt: { $dte: '2026-01-01T00:00+01:00' } } }] },
  oid: { 'person._id': { $in: [{ $oid: '6b0847194f911ed420997f15' }] } },
  persona: { 'person._id': { $personaIdent: { key: 'persona.import.classe', value: '4eB' } } },
  big: bigObject('d'),
  jwt: 'eyJhbGciOiJIUzI1NiJ9.e30.signature', // filtre JWT brut (mode JWT_SECURED, avant vérification serveur)
};

// --- Construction d'une visualisation --------------------------------------------------------------


/**
 * spec : { type, operator, value, group, xOperator, yOperator, xValue, yValue, xQuery, yQuery,
 *          period, timezone, benchmark, filters: [noms], extra: {champ: valeur stockée} }
 * Les valeurs ABSENT omettent le champ ; { stored: '…' } fixe la chaîne stockée telle quelle.
 */
async function buildVisualisation(spec) {
  const model = {
    _id: objectId(),
    organisation: '6b083fe419b92523f89d6725',
    owner: '6b083fe319b925c36e9d6722',
    description: 'cas généré',
    isPublic: false,
    stacked: true,
    showStats: true,
  };
  const set = (field, value) => {
    if (value !== ABSENT && value !== undefined) model[field] = value;
  };
  set('type', spec.type);
  set('previewPeriod', spec.period);
  set('timezone', spec.timezone);
  set('benchmarkingEnabled', spec.benchmark);
  set('axesoperator', spec.operator);
  set('axesxOperator', spec.xOperator);
  set('axesyOperator', spec.yOperator);
  set('axesxLabel', spec.xLabel);
  const storedOverrides = {};
  for (const [field, value] of [['axesgroup', spec.group], ['axesvalue', spec.value], ['axesxValue', spec.xValue], ['axesyValue', spec.yValue], ['axesxQuery', spec.xQuery], ['axesyQuery', spec.yQuery]]) {
    if (value === ABSENT || value === undefined) continue;
    if (value && typeof value === 'object' && 'stored' in value) storedOverrides[field] = value.stored;
    else model[field] = value;
  }
  const stored = await presave(model);
  Object.assign(stored, storedOverrides);
  if (spec.filters === ABSENT) delete stored.filters;
  else stored.filters = spec.filters.map(filterString);
  Object.assign(stored, spec.extra ?? {});
  return stored;
}

// --- Cas ---------------------------------------------------------------------------------------------

const cases = [];

async function addCase(id, { visualisation, orgTimezone = ABSENT, now, dashboardFilter = ABSENT }) {
  const input = { visualisation };
  if (orgTimezone !== ABSENT) input.orgTimezone = orgTimezone;
  input.now = now;
  if (dashboardFilter !== ABSENT) input.dashboardFilter = dashboardFilter;
  const { ok, json } = await post('/pipelines', input);
  const c = { id, input };
  if (ok) c.output = json;
  else c.error = String(json.error).split('\n')[0];
  cases.push(c);
}

const randomTimezone = () => pick(TIMEZONES);
const randomContext = () => ({
  orgTimezone: pick(ORG_TIMEZONES),
  now: pick(NOWS),
  dashboardFilter: DASHBOARD_FILTERS[chance(0.4) ? 'none' : pick(Object.keys(DASHBOARD_FILTERS))],
});
const randomCommon = () => ({
  period: pick(PERIODS),
  timezone: randomTimezone(),
  benchmark: chance(0.15) ? pick([true, 'true', 1, 0, null]) : pick([false, ABSENT]),
  filters: randomFilters(),
});
const randomGroup = () => (chance(0.05) ? pick(GROUP_AXES_ODD) : chance(0.1) ? ABSENT : groupAxis(pick(GROUP_KEYS), chance(0.3) ? pick(DEFINITION_TYPES) : ABSENT));
const randomValue = () => pick(VALUE_AXES);
const XQUERIES = [ABSENT, { stored: 'null' }, { $match: {} }, {}, { $match: FILTERS.verb.$match }, { $match: FILTERS.dte('2026-03-29T02:30').$match },
  { $match: { $and: [{ 'statement.verb.id': { $in: [VERB('completed')] } }, { 'statement.context.platform': { $in: ['Stream', 'Curatr'] } }] } },
  { $match: FILTERS.big.$match }, { stored: '{"$match":"texte"}' }];
const XQUERY_THROWING = { stored: '{"$match":null}' };

async function main() {
  const db = readDatabase();
  const orgTimezone = new Map(db.organisations.map((o) => [o._id, o.timezone]));
  const shareFilters = db.dashboards.flatMap((d) => d.shareable ?? []).map((s) => JSON.parse(s.filter));

  // 1. Visualisations réelles : contexte de l'enregistrement golden, puis variantes.
  const contexts = [
    { name: 'golden', now: '2026-11-26T14:19:00.000Z', org: true },
    { name: 'golden-share', now: '2026-11-26T14:19:00.000Z', org: true, dashboardFilter: shareFilters.find((f) => Object.keys(f).length) ?? {} },
    { name: 'front-empty-share', now: '2026-11-26T14:19:37.123Z', org: true, dashboardFilter: {} },
    { name: 'no-org-tz', now: '2026-03-29T01:00:00.000Z' },
    ...NOWS.slice(1, 9).map((now, i) => ({ name: `now-${i}`, now, org: i % 2 === 0, dashboardFilter: i % 3 === 0 ? DASHBOARD_FILTERS.dte : ABSENT })),
    { name: 'ny', now: '2026-11-01T06:00:00.000Z', orgTimezone: 'America/New_York' },
    { name: 'kolkata', now: '2026-06-14T18:30:00.000Z', orgTimezone: 'Asia/Kolkata', dashboardFilter: DASHBOARD_FILTERS.big },
  ];
  for (const viz of db.visualisations) {
    for (const ctx of contexts) {
      const org = ctx.orgTimezone ?? (ctx.org ? (orgTimezone.get(viz.organisation) ?? ABSENT) : ABSENT);
      await addCase(`real/${viz._id}/${ctx.name}`, { visualisation: viz, orgTimezone: org, now: ctx.now, dashboardFilter: ctx.dashboardFilter ?? ABSENT });
    }
  }
  console.log(`réelles : ${db.visualisations.length} visualisations, ${cases.length} cas`);

  // 2. Les 13 modèles (buildModel + preSave du front), dans plusieurs contextes.
  const { json: templateNames } = await post('/templates', {});
  for (const name of templateNames) {
    const { ok, json: base } = await post('/template', { name, owner: '6b083fe319b925c36e9d6722' });
    if (!ok) throw new Error(`template ${name} : ${base.error}`);
    for (let i = 0; i < 12; i += 1) {
      const visualisation = { _id: objectId(), organisation: '6b083fe419b92523f89d6725', ...base };
      if (i % 3 === 1) visualisation.timezone = pick(['Asia/Kolkata', '+05:30', 'America/New_York', 'Europe/Paris']);
      if (i % 4 === 2) visualisation.benchmarkingEnabled = true;
      if (i % 5 === 3) visualisation.previewPeriod = pick(PERIODS.filter((p) => p !== ABSENT));
      await addCase(`template/${name}/${i}`, { visualisation, ...randomContext() });
    }
  }
  console.log(`+ modèles : ${cases.length} cas`);

  // 3. Graphiques : produit complet opérateur × valeur × groupe (grouper), autres dimensions tirées au sort.
  let n = 0;
  const chartGroups = [...GROUP_KEYS.map((k) => groupAxis(k)), ...CONTEXT_ACTIVITIES.map((k) => groupAxis(k, 'http://id.tincanapi.com/activitytype/school-assignment')),
    groupAxis(CONTEXT_ACTIVITIES[0], ''), groupAxis('statement.context.contextActivities.foo', 'http://x'), ABSENT, { stored: 'null' }, { stored: '{}' }];
  const chartValues = [ABSENT, ...['statements', 'people', 'activities', 'verb', 'type', 'scaled', 'raw', 'steps', 'response', EXT_TEMPS, '', 'constructor', null, OBJECT_KEYS[0], OBJECT_KEYS[1]].map(valueAxis), { stored: 'null' }, RAW_AXES[0]];
  for (const operator of OPERATORS) {
    for (const value of chartValues) {
      for (const group of chartGroups) {
        const visualisation = await buildVisualisation({ type: CHART_TYPES[n % CHART_TYPES.length], operator, value, group, ...randomCommon() });
        await addCase(`chart/${n}`, { visualisation, ...randomContext() });
        n += 1;
      }
    }
  }
  console.log(`+ graphiques : ${cases.length} cas`);

  // 4. Compteurs : opérateur × valeur × groupe (le groupe ne sert qu'aux opérateurs unique* modificateurs).
  n = 0;
  const counterGroups = ['date', 'hour', 'weekday', 'month', 'people', 'persona.import.classe', CONTEXT_ACTIVITIES[1], ABSENT].map((k) => groupAxis(k)).concat([{ optionKey: 5, searchString: '5' }, ...OBJECT_KEYS.slice(0, 5).map((key) => ({ optionKey: key, searchString: 'x' })), RAW_AXES[0]]);
  const counterValues = [ABSENT, ...['statements', 'people', 'activities', 'verb', 'type', 'scaled', 'raw', 'steps', 'response', EXT_TEMPS, 'toString', 42, OBJECT_KEYS[0], OBJECT_KEYS[4]].map(valueAxis), { stored: '[]' }];
  for (const operator of OPERATORS) {
    for (const value of counterValues) {
      for (const group of counterGroups) {
        const visualisation = await buildVisualisation({ type: COUNTER_TYPES[n % COUNTER_TYPES.length], operator, value, group, ...randomCommon() });
        await addCase(`counter/${n}`, { visualisation, ...randomContext() });
        n += 1;
      }
    }
  }
  console.log(`+ compteurs : ${cases.length} cas`);

  // 5. Correlation (XVSY) : opérateurs, valeurs et requêtes par axe.
  for (n = 0; n < 500; n += 1) {
    const visualisation = await buildVisualisation({
      type: XVSY_TYPES[n % 2],
      xOperator: pick(OPERATORS), yOperator: pick(OPERATORS),
      xValue: randomValue(), yValue: randomValue(),
      xQuery: pick(XQUERIES), yQuery: pick(XQUERIES),
      group: randomGroup(), operator: chance(0.2) ? pick(OPERATORS) : ABSENT, value: chance(0.2) ? randomValue() : ABSENT,
      xLabel: chance(0.3) ? 'Interactions' : ABSENT,
      ...randomCommon(),
    });
    await addCase(`xvsy/${n}`, { visualisation, ...randomContext() });
  }
  console.log(`+ corrélations : ${cases.length} cas`);

  // 6. Tirages libres sur toutes les dimensions (dont types absents ou inconnus).
  const ALL_TYPES = [...CHART_TYPES, ...XVSY_TYPES, ...COUNTER_TYPES, ...OTHER_TYPES];
  for (n = 0; n < 1500; n += 1) {
    const visualisation = await buildVisualisation({
      type: pick(ALL_TYPES), operator: pick(OPERATORS), value: randomValue(), group: randomGroup(),
      xOperator: chance(0.3) ? pick(OPERATORS) : ABSENT, yOperator: chance(0.3) ? pick(OPERATORS) : ABSENT,
      xValue: chance(0.3) ? randomValue() : ABSENT, yValue: chance(0.3) ? randomValue() : ABSENT,
      xQuery: chance(0.3) ? pick(XQUERIES) : ABSENT, yQuery: chance(0.3) ? pick(XQUERIES) : ABSENT,
      ...randomCommon(),
    });
    await addCase(`random/${n}`, { visualisation, ...randomContext() });
  }
  console.log(`+ tirages : ${cases.length} cas`);

  // 7. Fuseaux × périodes × dates : chaque combinaison, sur un graphique par date et un compteur.
  n = 0;
  for (const timezone of TIMEZONES) {
    for (const period of PERIODS) {
      for (const now of NOWS) {
        if (!chance(0.35)) continue;
        const visualisation = await buildVisualisation({
          type: pick(['LEADERBOARD', 'COUNTER', 'STATEMENTS']), operator: pick(['uniqueCount', 'uniqueMax', 'count']), value: valueAxis(pick(['statements', 'scaled'])),
          group: groupAxis(pick(['date', 'hour', 'weekday', 'month'])), period, timezone, benchmark: chance(0.5),
          filters: [`dte:${pick(DTE_VALUES)}`],
        });
        await addCase(`dates/${n}`, { visualisation, orgTimezone: pick(ORG_TIMEZONES), now, dashboardFilter: chance(0.3) ? DASHBOARD_FILTERS.dte : ABSENT });
        n += 1;
      }
    }
  }
  console.log(`+ dates : ${cases.length} cas`);

  // 8. Cas limites nommés, dont ceux où le front d'origine échoue.
  const edge = async (name, spec, ctx = {}) => {
    const visualisation = await buildVisualisation({ type: 'LEADERBOARD', filters: ['verb'], ...spec });
    await addCase(`edge/${name}`, { visualisation, now: NOWS[0], orgTimezone: 'Europe/Paris', ...ctx });
  };
  await edge('no-type', { type: ABSENT, filters: ['builder', 'big', 'dteOdd'] });
  await edge('no-type-benchmark', { type: ABSENT, benchmark: true, filters: ['verb', 'noMatch'] });
  await edge('no-type-share', { type: ABSENT, filters: ['verb'] }, { dashboardFilter: DASHBOARD_FILTERS.dte });
  await edge('no-filters-field', { filters: ABSENT });
  await edge('empty-filters', { filters: [] });
  await edge('filters-object', { filters: [], extra: { filters: { a: '{"$match":{"x":1}}', b: 'pas du json' } } });
  await edge('filters-of-objects', { filters: [], extra: { filters: [{ $match: { x: 1 } }, ['{"$match":{}}'], 7, true, null] } });
  await edge('filters-of-objects-share', { filters: [], extra: { filters: [{ $match: { x: 1 } }, ['1']] } }, { dashboardFilter: {} });
  await edge('old-axes-only', { operator: ABSENT, extra: { axes: JSON.stringify({ group: { optionKey: 'verb' }, value: { optionKey: 'people' }, operator: 'count' }) } });
  await edge('old-axes-object', { extra: { axes: { axesgroup: '{"optionKey":"people","searchString":"P"}', filters: ['{"$match":{"y":2}}'] } } });
  await edge('axes-field-absent', { extra: { axes: undefined } });
  await edge('axesquery', { extra: { axesquery: '{"$match":{"z":1}}' } });
  await edge('extra-axes-fields', { extra: { axesxLabel: 'X', axesyLabel: 'Y', axes_: '{"a":1}', axesgroupe: 'x' } });
  await edge('constructor-root-field', { extra: { constructor: 'x' } });
  await edge('raw-match', { filters: ['rawConstructor', 'rawSizeZero', 'nestedConstructor', 'getKey'] });
  await edge('raw-match-share', { filters: ['rawConstructor', 'nestedConstructor'] }, { dashboardFilter: DASHBOARD_FILTERS.dte });
  await edge('raw-series', { filters: [], extra: { filters: ['{"constructor":1,"$match":{"x":1}}', '{"constructor":1,"size":0}'] } });
  await edge('throw-raw-series-get', { filters: [], extra: { filters: ['{"constructor":1,"get":"x","$match":{"x":1}}'] } });
  await edge('throw-raw-series-share', { filters: [], extra: { filters: ['{"constructor":1,"$match":{"x":1}}'] } }, { dashboardFilter: {} });
  await edge('raw-xquery', { type: 'XVSY', xQuery: { stored: '{"constructor":1,"$match":{"x":1}}' }, yQuery: { stored: '{"$match":{"constructor":1,"size":3}}' }, xOperator: 'count', yOperator: 'max' });
  await edge('object-optionkeys-counter', { type: 'COUNTER', operator: 'uniqueMax', value: valueAxis(OBJECT_KEYS[0]), group: groupAxis(OBJECT_KEYS[0]) });
  await edge('throw-raw-tostring-optionkey', { operator: 'count', value: valueAxis(OBJECT_KEYS[5]) });
  await edge('proto-key', { filters: [], extra: { filters: ['{"$match":{"__proto__":{"$dte":"2026-01-01T00:00Z"}}}', '{"$match":{"a":1,"__proto__":5}}'] } });
  await edge('proto-key-no-type', { type: ABSENT, filters: [], extra: { filters: ['{"$match":{"__proto__":{"x":1},"b":2}}'] } });
  await edge('numeric-keys', { filters: ['numericKeys', 'bigNumericKeys'] });
  await edge('dashboard-filters-real', { filters: ['verb', 'builder'] }, { dashboardFilter: shareFilters.find((f) => Object.keys(f).length) ?? {} });
  await edge('dashboard-jwt', { filters: ['verb'] }, { dashboardFilter: DASHBOARD_FILTERS.jwt });
  await edge('dashboard-list', { filters: ['verb'] }, { dashboardFilter: [{ a: 1 }, { b: 2 }] });
  await edge('dashboard-big', { filters: ['big'] }, { dashboardFilter: DASHBOARD_FILTERS.big });
  await edge('dashboard-falsy', { filters: ['verb'] }, { dashboardFilter: 0 });
  await edge('timezone-empty-org-empty', { timezone: '' }, { orgTimezone: '' });
  await edge('xvsy-query-null', { type: 'XVSY', xQuery: { stored: 'null' }, yQuery: XQUERIES[4], xOperator: 'count', yOperator: 'uniqueCount' });
  // Le front d'origine échoue : le portage doit échouer aussi.
  await edge('throw-match-null', { filters: ['verb', 'matchNull'] });
  await edge('throw-filter-null-share', { filters: ['jsonNull'] }, { dashboardFilter: {} });
  await edge('filter-null-no-share', { filters: ['jsonNull'] });
  await edge('throw-filter-string-share', { filters: ['jsonString'] }, { dashboardFilter: {} });
  await edge('throw-group-null-optionkey', { group: { optionKey: null, searchString: 'x' } });
  await edge('throw-group-number-chart', { group: { optionKey: 5, searchString: '5' } });
  await edge('throw-xquery-match-null', { type: 'XVSY', xQuery: XQUERY_THROWING, xOperator: 'count' });
  await edge('throw-axes-invalid-json', { extra: { axes: '{oups' } });
  await edge('throw-axesgroup-invalid-json', { group: { stored: '{oups' } });
  await edge('throw-filters-string', { filters: [], extra: { filters: 'pas une liste' } });
  await edge('throw-filters-null', { filters: [], extra: { filters: null } });
  await edge('throw-today-number-timezone', { period: 'TODAY', timezone: 5 });
  await edge('number-timezone-not-today', { period: 'LAST_7_DAYS', timezone: 5, filters: ['empty'] });
  await edge('throw-number-timezone-dte', { period: 'LAST_7_DAYS', timezone: 5, filters: ['dte:2026-01-01T00:00Z'] });
  console.log(`+ cas limites : ${cases.length} cas`);

  // Couverture, par dimension.
  const coverage = Object.create(null);
  const count = (dim, value) => {
    coverage[dim] ??= Object.create(null);
    const key = typeof value === 'string' ? value : `${JSON.stringify(value)} (${Array.isArray(value) ? 'liste' : value === null ? 'null' : typeof value})`;
    coverage[dim][key] = (coverage[dim][key] ?? 0) + 1;
  };
  const optionKey = (s) => {
    if (s === undefined) return '(absent)';
    try { const v = JSON.parse(s); return v && typeof v === 'object' && 'optionKey' in v ? v.optionKey : `(stocké ${s})`; } catch { return `(stocké ${s})`; }
  };
  for (const c of cases) {
    const v = c.input.visualisation;
    const field = (f) => (f in v ? v[f] : '(absent)');
    count('type', field('type'));
    count('axesoperator', field('axesoperator'));
    for (const f of ['axesxOperator', 'axesyOperator']) if (f in v) count('axesx/yOperator', v[f]);
    count('axesvalue', optionKey(v.axesvalue));
    for (const f of ['axesxValue', 'axesyValue']) if (f in v) count('axesx/yValue', optionKey(v[f]));
    count('axesgroup', optionKey(v.axesgroup));
    if (v.axesgroup) { try { const g = JSON.parse(v.axesgroup); if (g && 'contextActivityDefinitionType' in g) count('contextActivityDefinitionType', g.contextActivityDefinitionType); } catch { /* stocké invalide */ } }
    for (const f of ['axesxQuery', 'axesyQuery']) if (f in v) count('axesx/yQuery', v[f].length > 40 ? `${v[f].slice(0, 40)}…` : v[f]);
    count('previewPeriod', field('previewPeriod'));
    count('timezone', field('timezone'));
    count('orgTimezone', 'orgTimezone' in c.input ? c.input.orgTimezone : '(absent)');
    count('now', c.input.now);
    count('dashboardFilter', c.input.dashboardFilter === undefined ? '(absent)' : Object.entries(DASHBOARD_FILTERS).find(([, f]) => JSON.stringify(f) === JSON.stringify(c.input.dashboardFilter))?.[0] ?? 'autre');
    count('benchmarkingEnabled', field('benchmarkingEnabled'));
    count('séries', Array.isArray(v.filters) ? v.filters.length : '(non liste)');
    count('résultat', c.error ? 'erreur du front' : 'pipelines');
  }

  const data = {
    meta: {
      description: 'Pipelines d\'agrégation calculés par le front React legacy (POST /pipelines de tools/seed/legacy/presave-server.js)',
      generator: 'tools/oracle/pipelines.mjs',
      seed: SEED,
      legacy: { immutable: '3.8.2', moment: '2.24.0', 'moment-timezone': '0.5.27 (tzdata 2019c)', node: '10', TZ: 'UTC' },
      cases: cases.length,
      coverage,
    },
    cases,
  };
  const gz = gzipSync(JSON.stringify(data), { level: 9 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gz);
  console.log(JSON.stringify(coverage, null, 1));
  console.log(`${cases.length} cas (${cases.filter((c) => c.error).length} erreurs du front) → ${out} (${(gz.length / 1024).toFixed(0)} Kio)`);
}

await main();
