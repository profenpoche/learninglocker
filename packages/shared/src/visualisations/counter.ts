// Étapes de comptage des compteurs (Counter et ses modèles).
// Code d'origine : legacy/ui/src/utils/visualisations/aggregationGroup/counter/{index,valueCounter,
// uniqueTotalStatementCounter,uniqueTotalCounter,uniqueModifierCounter}.js.

import {
  VALUE_OP_CASE,
  createStagePipeline,
  firstValuesOf,
  getOperator,
  getValueOpCase,
  keyExists,
  type Stage,
  type ValueOpCase,
} from './helpers.js';
import { group, value } from './projections.js';

// Combinaison : I C F.
const valueCounter = ({ operator, projections }: { operator: string; projections: Stage }): Stage[] => [
  {
    $group: {
      _id: null,
      count: {
        [operator]: '$value',
      },
      ...firstValuesOf(projections),
    },
  },
];

// Combinaison : I J E.
const uniqueTotalStatementCounter = ({ projections }: { projections: Stage }): Stage[] => [
  {
    $group: {
      _id: null,
      count: {
        $sum: 1,
      },
      ...firstValuesOf(projections),
    },
  },
];

// Combinaison : I C/D E.
const uniqueTotalCounter = ({ projections }: { projections: Stage }): Stage[] => [
  {
    $group: {
      _id: '$value',
      ...firstValuesOf(projections),
    },
  },
  {
    $group: {
      _id: null,
      count: {
        $sum: 1,
      },
      ...firstValuesOf(projections),
    },
  },
];

// Combinaison : A/B J G.
const uniqueModifierCounter = ({ operator, projections }: { operator: string; projections: Stage }): Stage[] => [
  {
    $group: {
      _id: '$group',
      count: {
        $sum: 1,
      },
      ...firstValuesOf(projections),
    },
  },
  {
    $group: {
      _id: null,
      count: {
        [operator]: '$count',
      },
      ...firstValuesOf(projections),
    },
  },
];

const getCountPipeline = ({ operatorType, valueOpCase, projections }: { operatorType: unknown; valueOpCase: ValueOpCase; projections: Stage }): Stage[] => {
  switch (valueOpCase) {
    case VALUE_OP_CASE.value:
      return valueCounter({ operator: getOperator(operatorType as string), projections });
    case VALUE_OP_CASE.uniqueStatementCount:
      return uniqueTotalStatementCounter({ projections });
    case VALUE_OP_CASE.uniqueCount:
      return uniqueTotalCounter({ projections });
    case VALUE_OP_CASE.uniqueStatementModifier:
    case VALUE_OP_CASE.uniqueModifier:
      return uniqueModifierCounter({ operator: getOperator(operatorType as string), projections });
    default:
      return [];
  }
};

interface CaseArgs {
  valueType: unknown;
  groupType: unknown;
  valueOpCase: ValueOpCase;
  timezone: unknown;
}

const getProjections = ({ valueType, groupType, valueOpCase, timezone }: CaseArgs): Stage => {
  switch (valueOpCase) {
    case VALUE_OP_CASE.value:
    case VALUE_OP_CASE.uniqueCount:
      return { value: value(valueType) };
    case VALUE_OP_CASE.uniqueStatementModifier:
    case VALUE_OP_CASE.uniqueModifier:
      return { group: group(groupType, timezone) };
    case VALUE_OP_CASE.uniqueStatementCount:
    default:
      return {};
  }
};

const getExistsMatch = ({ valueType, groupType, valueOpCase }: Omit<CaseArgs, 'timezone'>): unknown => {
  switch (valueOpCase) {
    case VALUE_OP_CASE.value:
    case VALUE_OP_CASE.uniqueCount:
      return keyExists(valueType);
    case VALUE_OP_CASE.uniqueStatementModifier:
    case VALUE_OP_CASE.uniqueModifier:
      return keyExists(groupType);
    case VALUE_OP_CASE.uniqueStatementCount:
    default:
      return {};
  }
};

export interface CounterArgs {
  valueType: unknown;
  groupType: unknown;
  operatorType: unknown;
  timezone: unknown;
}

/** Étapes de comptage d'un compteur (un seul résultat, `_id: null`). */
export const counter = ({ valueType, groupType, operatorType, timezone }: CounterArgs): Stage[] => {
  const valueOpCase = getValueOpCase({ valueType, operatorType });
  const existsMatch = getExistsMatch({ valueType, groupType, valueOpCase });
  const projections = getProjections({ valueType, groupType, valueOpCase, timezone });
  const matchStage = createStagePipeline('$match', existsMatch);
  const projectStage = createStagePipeline('$project', projections);
  const countPipeline = getCountPipeline({ operatorType, valueOpCase, projections });
  return [...matchStage, ...projectStage, ...countPipeline];
};
