// Options proposées par les éditeurs de visualisation : opérateurs, valeurs, groupes.
// Code d'origine : legacy/ui/src/utils/visualisations/localOptions.js (OrderedMap → objets, dont
// l'ordre d'insertion est conservé ; aucune clé n'est un entier).

import {
  COUNTER,
  FREQUENCY,
  LEADERBOARD,
  PIE,
  STATEMENTS,
  TEMPLATE_ACTIVITY_OVER_TIME,
  TEMPLATE_LAST_7_DAYS_STATEMENTS,
  TEMPLATE_LEARNING_EXPERIENCE_TYPE,
  TEMPLATE_MOST_ACTIVE_PEOPLE,
  TEMPLATE_MOST_POPULAR_ACTIVITIES,
  TEMPLATE_MOST_POPULAR_VERBS,
  TEMPLATE_STREAM_ACTIVITIES_WITH_MOST_COMMENTS,
  TEMPLATE_STREAM_COMMENT_COUNT,
  TEMPLATE_STREAM_INTERACTIONS_VS_ENGAGEMENT,
  TEMPLATE_STREAM_LEARNER_INTERACTIONS_BY_DATE_AND_VERB,
  TEMPLATE_STREAM_PROPORTION_OF_SOCIAL_INTERACTIONS,
  TEMPLATE_STREAM_USER_ENGAGEMENT_LEADERBOARD,
  TEMPLATE_WEEKDAYS_ACTIVITY,
  XVSY,
} from './constants.js';

/** Option d'axe telle que stockée : `{ optionKey, searchString }`. */
export interface OptionModel {
  optionKey: string;
  searchString: string;
}

const createOptionModels = (options: Readonly<Record<string, string>>): Readonly<Record<string, OptionModel>> =>
  Object.fromEntries(Object.entries(options).map(([optionKey, searchString]) => [optionKey, { optionKey, searchString }]));

export const UNIQUENESS_OPS = ['uniqueCount', 'uniqueAverage', 'uniqueMax', 'uniqueMin'] as const;

const LINE_OPERATOR_OPTS: Readonly<Record<string, string>> = {
  uniqueCount: 'Total unique number of',
  count: 'Sum of',
  average: 'Average of',
  max: 'Max from',
  min: 'Min from',
};

export const OPERATOR_OPTS: Readonly<Record<string, string>> = {
  ...LINE_OPERATOR_OPTS,
  uniqueAverage: 'Average unique number of',
  uniqueMax: 'Max unique number of',
  uniqueMin: 'Min unique number of',
};

export const VALUE_OPTS = createOptionModels({
  scaled: 'Scaled results',
  raw: 'Raw results',
  steps: 'Steps',
});

export const UNIQUENESS_VALUE_OPTS: Readonly<Record<string, OptionModel>> = {
  ...createOptionModels({
    statements: 'Statements',
    people: 'People',
    activities: 'Activities',
    verb: 'Verbs',
    type: 'Activity types',
  }),
  ...VALUE_OPTS,
};

export const GROUP_OPTS = createOptionModels({
  date: 'Date',
  hour: 'Hour',
  weekday: 'Day',
  month: 'Month',
  year: 'Year',
  people: 'Person',
  activities: 'Activity',
  verb: 'Verb',
  type: 'Activity Type',
  raw: 'Raw Result',
  response: 'Result Response',
});

/** Opérateurs proposés pour un type (Line : sans les unique* « modificateurs »). */
export const getTypeOpts = (type: unknown): Readonly<Record<string, string>> => {
  switch (type) {
    case FREQUENCY:
    case TEMPLATE_ACTIVITY_OVER_TIME:
      return LINE_OPERATOR_OPTS;
    case XVSY:
    case STATEMENTS:
    case LEADERBOARD:
    case COUNTER:
    case PIE:
    case TEMPLATE_LAST_7_DAYS_STATEMENTS:
    case TEMPLATE_MOST_ACTIVE_PEOPLE:
    case TEMPLATE_MOST_POPULAR_ACTIVITIES:
    case TEMPLATE_MOST_POPULAR_VERBS:
    case TEMPLATE_WEEKDAYS_ACTIVITY:
    case TEMPLATE_STREAM_INTERACTIONS_VS_ENGAGEMENT:
    case TEMPLATE_STREAM_COMMENT_COUNT:
    case TEMPLATE_STREAM_LEARNER_INTERACTIONS_BY_DATE_AND_VERB:
    case TEMPLATE_STREAM_USER_ENGAGEMENT_LEADERBOARD:
    case TEMPLATE_STREAM_PROPORTION_OF_SOCIAL_INTERACTIONS:
    case TEMPLATE_STREAM_ACTIVITIES_WITH_MOST_COMMENTS:
    case TEMPLATE_LEARNING_EXPERIENCE_TYPE:
      return OPERATOR_OPTS;
    default:
      return {};
  }
};
