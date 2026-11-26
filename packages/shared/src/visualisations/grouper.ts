// Étapes de regroupement des graphiques (Bar, Column, Line, Pie, Correlation et leurs modèles).
// Code d'origine : legacy/ui/src/utils/visualisations/aggregationGroup/grouper/{index,valueGrouper,
// uniqueTotalStatementGrouper,uniqueTotalGrouper,uniqueStatementModifierGrouper,uniqueModifierGrouper}.js.

import { RESPONSE_ROWS_LIMIT } from './constants.js';
import {
  VALUE_OP_CASE,
  buildPeriodGroupKey,
  createStagePipeline,
  firstValuesOf,
  getOperator,
  getValueOpCase,
  isContextActivity,
  keyExists,
  type Stage,
  type ValueOpCase,
} from './helpers.js';
import { date, group, model, value } from './projections.js';

// Combinaison : A/B C F.
const valueGrouper = ({ operator, projections }: { operator: string; projections: Stage }): Stage[] => [
  {
    $group: {
      _id: '$group',
      count: {
        [operator]: '$value',
      },
      ...firstValuesOf(projections),
    },
  },
];

// Combinaison : A/B J E.
const uniqueTotalStatementGrouper = ({ projections }: { projections: Stage }): Stage[] => [
  {
    $group: {
      _id: '$group',
      count: {
        $sum: 1,
      },
      ...firstValuesOf(projections),
    },
  },
];

// Combinaison : A/B C/D E.
const uniqueTotalGrouper = ({ projections }: { projections: Stage }): Stage[] => [
  {
    $group: {
      _id: {
        group: '$group',
        value: '$value',
      },
      ...firstValuesOf(projections),
    },
  },
  {
    $group: {
      _id: '$_id.group',
      count: {
        $sum: 1,
      },
      ...firstValuesOf(projections),
    },
  },
];

interface ModifierArgs {
  groupType: string;
  operator: string;
  projections: Stage;
  timezone: unknown;
}

// Combinaison : B C/D G.
const uniqueStatementModifierGrouper = ({ groupType, operator, projections, timezone }: ModifierArgs): Stage[] => [
  {
    $group: {
      _id: '$date',
      count: {
        $sum: 1,
      },
      ...firstValuesOf(projections),
    },
  },
  {
    $group: {
      _id: buildPeriodGroupKey(groupType, timezone),
      count: {
        [operator]: '$count',
      },
      ...firstValuesOf(projections),
    },
  },
];

// Combinaison : B C/D G.
const uniqueModifierGrouper = ({ groupType, operator, projections, timezone }: ModifierArgs): Stage[] => [
  {
    $group: {
      _id: {
        date: '$date',
        value: '$value',
      },
      ...firstValuesOf(projections),
    },
  },
  {
    $group: {
      _id: '$_id.date',
      count: {
        $sum: 1,
      },
      ...firstValuesOf(projections),
    },
  },
  {
    $group: {
      _id: buildPeriodGroupKey(groupType, timezone),
      count: {
        [operator]: '$count',
      },
      ...firstValuesOf(projections),
    },
  },
];

interface CaseArgs {
  valueType: unknown;
  groupType: string;
  valueOpCase: ValueOpCase;
  timezone: unknown;
}

const getGroupPipeline = ({ operatorType, groupType, valueOpCase, projections, timezone }: Omit<CaseArgs, 'valueType'> & { operatorType: unknown; projections: Stage }): Stage[] => {
  switch (valueOpCase) {
    case VALUE_OP_CASE.value:
      return valueGrouper({ operator: getOperator(operatorType as string), projections });
    case VALUE_OP_CASE.uniqueStatementCount:
      return uniqueTotalStatementGrouper({ projections });
    case VALUE_OP_CASE.uniqueCount:
      return uniqueTotalGrouper({ projections });
    case VALUE_OP_CASE.uniqueStatementModifier:
      return uniqueStatementModifierGrouper({ operator: getOperator(operatorType as string), groupType, projections, timezone });
    case VALUE_OP_CASE.uniqueModifier:
      return uniqueModifierGrouper({ operator: getOperator(operatorType as string), groupType, projections, timezone });
    default:
      return [];
  }
};

const getProjections = ({ valueType, groupType, valueOpCase, timezone }: CaseArgs): Stage => {
  switch (valueOpCase) {
    case VALUE_OP_CASE.value:
    case VALUE_OP_CASE.uniqueCount:
      return {
        group: group(groupType, timezone),
        value: value(valueType),
        model: model(groupType, timezone),
      };
    case VALUE_OP_CASE.uniqueStatementModifier:
      return {
        date: date(groupType, timezone),
        timestamp: '$timestamp',
        model: model(groupType, timezone),
      };
    case VALUE_OP_CASE.uniqueModifier:
      return {
        date: date(groupType, timezone),
        timestamp: '$timestamp',
        value: value(valueType),
        model: model(groupType, timezone),
      };
    case VALUE_OP_CASE.uniqueStatementCount:
      return {
        group: group(groupType, timezone),
        model: model(groupType, timezone),
      };
    default:
      return {};
  }
};

const getExistsMatch = ({ valueType, groupType, valueOpCase }: Omit<CaseArgs, 'timezone'>): unknown => {
  switch (valueOpCase) {
    case VALUE_OP_CASE.value:
    case VALUE_OP_CASE.uniqueCount:
      return { ...(keyExists(valueType) as object), ...(keyExists(groupType) as object) };
    case VALUE_OP_CASE.uniqueModifier:
      // Le groupe est censé être une période (le timestamp existe toujours).
      return keyExists(valueType);
    case VALUE_OP_CASE.uniqueStatementCount:
      return keyExists(groupType);
    case VALUE_OP_CASE.uniqueStatementModifier:
    default:
      return {};
  }
};

const createPersonaAttributeStages = (groupType: string): Stage[] => {
  // « persona.import.a.b » donne « a » : comportement d'origine.
  const personaAttrsKey = groupType.split('.')[2] || '';

  return [
    ...createStagePipeline('$lookup', {
      from: 'personaAttributes',
      as: 'personaAttrs',
      let: { personaId: '$person._id' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$personaId', '$$personaId'] },
                { $eq: ['$key', personaAttrsKey] },
              ],
            },
          },
        },
      ],
    }),
    ...createStagePipeline('$match', { personaAttrs: { $exists: true } }),
    ...createStagePipeline('$unwind', { path: '$personaAttrs' }),
    ...createStagePipeline('$match', { 'personaAttrs.key': personaAttrsKey }),
  ];
};

const getPostReqs = (): Stage[] => [
  { $sort: { count: -1 } },
  { $limit: RESPONSE_ROWS_LIMIT },
  { $project: { _id: 1, count: 1, model: 1 } },
];

const getContextActivityTypeMatch = (groupType: string, pattern: unknown): Stage | null => {
  if (isContextActivity(groupType) && typeof pattern === 'string') {
    return {
      [`${groupType}.definition.type`]: pattern,
    };
  }
  return null;
};

export interface GrouperArgs {
  valueType: unknown;
  groupType: unknown;
  operatorType: unknown;
  timezone: unknown;
  contextActivityDefinitionType?: unknown;
}

/** Étapes de regroupement d'un axe de graphique (après les filtres de période et de requête). */
export const grouper = ({ valueType, groupType, operatorType, timezone, contextActivityDefinitionType }: GrouperArgs): Stage[] => {
  if (typeof groupType !== 'string') {
    // L'original appelle groupType.startsWith(…).
    throw new TypeError('groupType.startsWith is not a function');
  }
  const valueOpCase = getValueOpCase({ valueType, operatorType });

  const isPersonaImportGroup = groupType.startsWith('persona.import.');
  const isContextActivities = groupType.startsWith('statement.context.contextActivities.');

  // 1. Existence des champs, attributs de persona, dépliage des contextActivities
  let preReqs: Stage[];
  if (isPersonaImportGroup) {
    preReqs = createPersonaAttributeStages(groupType);
  } else {
    const existsMatchStage = createStagePipeline('$match', getExistsMatch({ valueType, groupType, valueOpCase }));
    preReqs = isContextActivities
      ? [...existsMatchStage, ...createStagePipeline('$unwind', { path: `$${groupType}` })]
      : existsMatchStage;
  }

  // 2. Type de définition des contextActivities
  const contextActivityTypeMatch = getContextActivityTypeMatch(groupType, contextActivityDefinitionType);
  const contextActivityTypeMatchStage = contextActivityTypeMatch ? createStagePipeline('$match', contextActivityTypeMatch) : [];

  // 3. Projection
  const projections = getProjections({
    valueType,
    groupType: isPersonaImportGroup ? 'personaAttrs.value' : groupType,
    valueOpCase,
    timezone,
  });
  const projectStage = createStagePipeline('$project', projections);

  // 4. Regroupement (avec le groupType d'origine, même pour un attribut de persona)
  const countPipeline = getGroupPipeline({ operatorType, groupType, valueOpCase, projections, timezone });

  // 5. Tri, limite, projection finale
  return [...preReqs, ...contextActivityTypeMatchStage, ...projectStage, ...countPipeline, ...getPostReqs()];
};
