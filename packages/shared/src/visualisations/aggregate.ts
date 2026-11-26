// Assemblage des pipelines par famille de type.
// Code d'origine : legacy/ui/src/utils/visualisations/{aggregateChart,aggregateCounter,aggregateXvsY}.js.
//
// `preReqs` (étapes de période et de requête) et `axes` sont des valeurs « fromJS » (voir immutable.ts).

import { update$dteTimezoneInternal } from '../dates/update-dte-timezone.js';
import { counter } from './counter.js';
import { grouper } from './grouper.js';
import { get, getIn, mapFromEntries, sizeOf, type IMap } from './immutable.js';

/** Un pipeline pour la série : préalables + regroupement (valeur « statements », groupe « date », uniqueCount par défaut). */
export const aggregateChart = (preReqs: readonly unknown[], axes: IMap, timezone: unknown): unknown[][] => {
  const valueType = getIn(axes, ['value', 'optionKey'], 'statements');
  const groupType = getIn(axes, ['group', 'optionKey'], 'date');
  const operatorType = get(axes, 'operator', 'uniqueCount');
  const contextActivityDefinitionType = getIn(axes, ['group', 'contextActivityDefinitionType'], null);
  const aggregationGroup = grouper({ valueType, groupType, operatorType, timezone, contextActivityDefinitionType });
  return [[...preReqs, ...aggregationGroup]];
};

/** Un pipeline pour la série : préalables + comptage. */
export const aggregateCounter = (preReqs: readonly unknown[], axes: IMap, timezone: unknown): unknown[][] => {
  const valueType = getIn(axes, ['value', 'optionKey'], 'statements');
  const groupType = getIn(axes, ['group', 'optionKey'], 'date');
  const operatorType = get(axes, 'operator', 'uniqueCount');
  const aggregationGroup = counter({ valueType, groupType, operatorType, timezone });
  return [[...preReqs, ...aggregationGroup]];
};

const aggregateScatterAxis = (axis: 'x' | 'y', preReqs: readonly unknown[], axes: IMap, timezone: unknown): unknown[] => {
  // « statement » au singulier : valeur par défaut d'origine (incohérente avec « statements »).
  const valueType = getIn(axes, [`${axis}Value`, 'optionKey'], 'statement');
  const groupType = getIn(axes, ['group', 'optionKey'], 'date');
  const operatorType = get(axes, `${axis}Operator`);
  const contextActivityDefinitionType = getIn(axes, ['group', 'contextActivityDefinitionType'], null);

  const match = getIn(axes, [`${axis}Query`, '$match'], mapFromEntries([]));
  // Fuseau des filtres « When » (timestamp et stored)
  const offsetFixedMatch = update$dteTimezoneInternal(match, timezone);
  const matchStage = sizeOf(offsetFixedMatch) === 0 ? [] : [{ $match: offsetFixedMatch }];

  const aggregationGroup = grouper({ valueType, groupType, operatorType, timezone, contextActivityDefinitionType });
  return [...preReqs, ...matchStage, ...aggregationGroup];
};

/** Deux pipelines pour la série : axe x puis axe y (Correlation). */
export const aggregateXvsY = (preReqs: readonly unknown[], axes: IMap, timezone: unknown): unknown[][] => [
  aggregateScatterAxis('x', preReqs, axes, timezone),
  aggregateScatterAxis('y', preReqs, axes, timezone),
];
