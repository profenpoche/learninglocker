// Expressions des étapes `$project` : groupe, valeur, modèle (libellé du groupe) et date.
// Code d'origine : legacy/ui/src/utils/visualisations/projections/{group,value,model,date,period}.js.
// Tables consultées par `table[clé]` comme à l'origine (voir l'en-tête de helpers.ts).

import { formatDate } from './helpers.js';
import { toPropertyKey } from './immutable.js';

export const periodKeys = ['date', 'minute', 'hour', 'weekday', 'month', 'year'] as const;

/** Expression d'une période (date, minute, hour, weekday, month, year), sinon undefined. */
export const period = (groupType: unknown, timezone: unknown): unknown => {
  const expression = {
    date: '$timestamp',
    timezone,
  };

  switch (groupType) {
    case 'date': return formatDate('%Y-%m-%d', timezone);
    case 'minute': return { $minute: expression };
    case 'hour': return { $hour: expression };
    case 'weekday': return { $dayOfWeek: expression };
    case 'month': return { $month: expression };
    case 'year': return { $year: expression };
    default: return undefined;
  }
};

const GROUP: Record<string, unknown> = {
  people: '$person._id',
  activities: '$statement.object.id',
  verb: '$statement.verb.id',
  type: '$statement.object.definition.type',
  raw: '$statement.result.score.raw',
  response: '$statement.result.response',
};

/** Expression « group » de la projection. */
export const group = (groupType: unknown, timezone: unknown): unknown => {
  const key = toPropertyKey(groupType);
  return GROUP[key] || period(groupType, timezone) || `$${key}`;
};

const VALUE: Record<string, unknown> = {
  scaled: '$statement.result.score.scaled',
  raw: '$statement.result.score.raw',
  response: '$statement.result.response',
  steps: '$statement.object.definition.extensions.http://lrs&46;learninglocker&46;net/define/extensions/steps',
  people: '$person._id',
  activities: '$statement.object.id',
  verb: '$statement.verb.id',
  type: '$statement.object.definition.type',
  statements: '$_id',
};

/** Expression « value » de la projection. */
export const value = (valueType: unknown): unknown => {
  const key = toPropertyKey(valueType);
  return VALUE[key] || `$${key}`;
};

const MODEL: Record<string, unknown> = {
  people: '$person.display',
  activities: {
    objectType: '$statement.object.objectType',
    id: '$statement.object.id',
    definition: {
      name: '$statement.object.definition.name',
    },
  },
  verb: '$statement.verb',
  raw: '$statement.result.score.raw',
  response: '$statement.result.response',
  type: '$statement.object.definition.type',
};

/** Expression « model » de la projection (ce qui sert de libellé au résultat). */
export const model = (groupType: unknown, timezone: unknown): unknown => {
  const key = toPropertyKey(groupType);
  return MODEL[key] || period(groupType, timezone) || `$${key}`;
};

/** Expression « date » des opérateurs unique* modificateurs. */
export const date = (groupType: unknown, timezone: unknown): unknown => {
  switch (groupType) {
    case 'minute': return formatDate('%Y-%m-%dT%H-%M', timezone);
    case 'hour': return formatDate('%Y-%m-%dT%H', timezone);
    case 'weekday': return formatDate('%Y-%m-%d', timezone);
    case 'month': return formatDate('%Y-%m', timezone);
    default: return 'PROBLEM IN DATE PROJECTION';
  }
};
