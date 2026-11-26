// Petites fonctions de construction des étapes d'agrégation.
// Code d'origine : legacy/ui/src/utils/visualisations/helpers/{keyExists,getOperator,valueOpCase,
// buildPeriodGroupKey,formatDate,firstValuesOf,createStagePipeline}.js et isContextActivity.js.
//
// Les tables de correspondance sont des objets littéraux consultés par `table[clé]`, comme à
// l'origine : une clé héritée d'Object.prototype (« constructor », « toString »…) y renvoie la valeur
// héritée. Ce comportement est conservé volontairement (identité des pipelines).

import { toPropertyKey } from './immutable.js';

export type Stage = Record<string, unknown>;

// --- keyExists -------------------------------------------------------------------------------------

const checkKeyExists = (key: string): Stage => ({ [key]: { $exists: true } });

const KEY_EXISTS: Record<string, unknown> = {
  scaled: checkKeyExists('statement.result.score.scaled'),
  raw: checkKeyExists('statement.result.score.raw'),
  response: checkKeyExists('statement.result.response'),
  steps: checkKeyExists('statement.object.definition.extensions.http://lrs&46;learninglocker&46;net/define/extensions'),
  people: checkKeyExists('person._id'),
  type: checkKeyExists('statement.object.definition.type'),
  activities: {},
  verb: {},
  statements: {},
  minute: {},
  hour: {},
  weekday: {},
  month: {},
  year: {},
  date: {},
};

/** Condition `$match` d'existence du champ lu pour une valeur ou un groupe. */
export const keyExists = (value: unknown): unknown => {
  const key = toPropertyKey(value);
  return KEY_EXISTS[key] || checkKeyExists(key);
};

// --- getOperator -----------------------------------------------------------------------------------

const OPERATORS: Record<string, string> = {
  count: '$sum',
  average: '$avg',
  max: '$max',
  min: '$min',
  uniqueCount: '$sum',
  uniqueAverage: '$avg',
  uniqueMax: '$max',
  uniqueMin: '$min',
};

/** Accumulateur MongoDB d'un opérateur de visualisation. */
export const getOperator = (operator: string): string => {
  const accumulator = OPERATORS[operator];
  if (accumulator === undefined) throw new Error(`Opérateur inconnu : ${operator}`);
  return accumulator;
};

// --- valueOpCase -----------------------------------------------------------------------------------

export const VALUE_OP_CASE = {
  other: 0,
  value: 1,
  uniqueStatementCount: 2,
  uniqueCount: 3,
  uniqueModifier: 4,
  uniqueStatementModifier: 5,
} as const;

export type ValueOpCase = (typeof VALUE_OP_CASE)[keyof typeof VALUE_OP_CASE];

/** Famille de calcul selon l'opérateur et la valeur (« statements » ou autre). */
export const getValueOpCase = ({ operatorType, valueType }: { operatorType: unknown; valueType: unknown }): ValueOpCase => {
  switch (operatorType) {
    case 'count':
    case 'average':
    case 'max':
    case 'min':
      return VALUE_OP_CASE.value;
    case 'uniqueCount':
      return valueType === 'statements' ? VALUE_OP_CASE.uniqueStatementCount : VALUE_OP_CASE.uniqueCount;
    case 'uniqueAverage':
    case 'uniqueMax':
    case 'uniqueMin':
      return valueType === 'statements' ? VALUE_OP_CASE.uniqueStatementModifier : VALUE_OP_CASE.uniqueModifier;
    default:
      return VALUE_OP_CASE.other;
  }
};

// --- Expressions de date ---------------------------------------------------------------------------

/** Expression `$dateToString` sur `$timestamp`. */
export const formatDate = (format: string, timezone: unknown): Stage => ({
  $dateToString: {
    date: '$timestamp',
    format,
    timezone,
  },
});

/**
 * Clé de regroupement des opérateurs unique* « modificateurs » (uniqueAverage, uniqueMax, uniqueMin).
 * Seuls minute, hour, weekday et month ont un sens ; sinon la chaîne d'origine
 * 'PROBLEM IN PERIOD PROJECTION' (le résultat équivaut alors à uniqueCount).
 */
export const buildPeriodGroupKey = (groupType: unknown, timezone: unknown): unknown => {
  const expression = {
    date: '$timestamp',
    timezone,
  };

  switch (groupType) {
    case 'minute': return { $minute: expression };
    case 'hour': return { $hour: expression };
    case 'weekday': return { $dayOfWeek: expression };
    case 'month': return { $month: expression };
    default: return 'PROBLEM IN PERIOD PROJECTION';
  }
};

// --- Divers ----------------------------------------------------------------------------------------

/** `{ clé: { $first: '$clé' } }` pour chaque clé des projections (lodash mapValues). */
export const firstValuesOf = (projections: Stage): Stage => {
  const out: Stage = {};
  for (const key of Object.keys(projections)) {
    out[key] = { $first: `$${key}` };
  }
  return out;
};

/** `[{ [stage]: contenu }]`, ou `[]` si le contenu n'a aucune clé propre énumérable. */
export const createStagePipeline = (stage: string, stageContent: unknown): Stage[] => {
  const keys = Object.keys(stageContent as object).length;
  if (keys === 0) return [];
  return [{ [stage]: stageContent }];
};

/** Vrai pour statement.context.contextActivities.{grouping|category|other|parent} exactement. */
export const isContextActivity = (groupType: unknown): boolean => {
  if (typeof groupType !== 'string') {
    return false;
  }
  const a = groupType.split('.');
  return a.length === 4
    && a[0] === 'statement'
    && a[1] === 'context'
    && a[2] === 'contextActivities'
    && ['grouping', 'category', 'other', 'parent'].includes(a[3] ?? '');
};
