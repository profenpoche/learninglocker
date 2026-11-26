// Pipelines d'agrégation d'une visualisation, série par série.
// Code d'origine : legacy/ui/src/utils/visualisations/{pipelineFromQuery,pipelinesFromQueries}.js.

import moment from 'moment-timezone';
import { periodToDate } from '../dates/periodToDate.js';
import { update$dteTimezoneInternal } from '../dates/update-dte-timezone.js';
import { aggregateChart, aggregateCounter, aggregateXvsY } from './aggregate.js';
import { CHART_TYPES, COUNTER_TYPES, XVSY_TYPES } from './constants.js';
import { fromJS, getIn, isMap, mapFromEntries, sizeOf, toJS, type IMap } from './immutable.js';

/** Instant de référence : Date, nombre de millisecondes ou chaîne ISO (lue par `new Date(…)`). */
export type Now = Date | number | string;

/**
 * Pipelines d'une visualisation : une entrée par série (deux avec la comparaison), chacune étant la
 * liste des pipelines de la série (un, ou deux pour Correlation). Sans type reconnu, chaque entrée est
 * le contenu du `$match` de la série (comportement d'origine).
 */
export type VisualisationPipelines = unknown[];

interface InternalArgs {
  query: unknown;
  axes: IMap;
  type: unknown;
  previewPeriod: unknown;
  timezone: unknown;
  currentMoment: moment.Moment;
  benchmarkingEnabled?: unknown;
}

const pipelineFromQueryInternal = ({ query: series, axes, type, previewPeriod, timezone, currentMoment, benchmarkingEnabled }: InternalArgs): unknown => {
  const periodStart = (): string | null => periodToDate(previewPeriod, timezone, currentMoment).toISOString();

  let previewPeriodMatch: unknown[] = [{
    $match: {
      timestamp: { $gte: { $dte: periodStart() } },
    },
  }];

  if (benchmarkingEnabled) {
    const previousStartDate = periodToDate(previewPeriod, timezone, currentMoment, 2).toISOString();
    previewPeriodMatch = [{
      $match: {
        timestamp: { $gte: { $dte: previousStartDate }, $lte: { $dte: periodStart() } },
      },
    }];
  }

  const query = getIn(series, ['query', '$match'], mapFromEntries([]));
  // Fuseau des filtres « When » (timestamp et stored)
  const offsetFixedQuery = update$dteTimezoneInternal(query, timezone);
  const queryMatch = sizeOf(offsetFixedQuery) === 0 ? [] : [{ $match: offsetFixedQuery }];

  const preReqs = [...previewPeriodMatch, ...queryMatch];

  if (typeof type === 'string') {
    if (CHART_TYPES.includes(type)) return aggregateChart(preReqs, axes, timezone);
    if (XVSY_TYPES.includes(type)) return aggregateXvsY(preReqs, axes, timezone);
    if (COUNTER_TYPES.includes(type)) return aggregateCounter(preReqs, axes, timezone);
  }
  // Type absent ou inconnu : l'original renvoie le $match de la série, sans réécriture des $dte.
  return query;
};

const pipelinesFromQueriesInternal = (args: Omit<InternalArgs, 'query' | 'currentMoment'> & { queries: unknown; now: Now }): unknown[] => {
  if (!Array.isArray(args.queries)) {
    throw new TypeError('queries.map is not a function');
  }
  // Secondes à 00 : le pipeline ne change qu'une fois par minute.
  const currentMoment = moment.utc(new Date(args.now).getTime()).startOf('minute');
  const { queries, axes, type, previewPeriod, timezone, benchmarkingEnabled } = args;

  if (benchmarkingEnabled) {
    return queries.flatMap((query: unknown) => [
      pipelineFromQueryInternal({ query: wrapQuery(query), axes, type, previewPeriod, timezone, currentMoment }),
      pipelineFromQueryInternal({ query: wrapQuery(query), axes, type, previewPeriod, timezone, currentMoment, benchmarkingEnabled }),
    ]);
  }
  return queries.map((query: unknown) => pipelineFromQueryInternal({ query: wrapQuery(query), axes, type, previewPeriod, timezone, currentMoment }));
};

// L'original range la série sous la clé « query » d'une Map d'arguments, puis lit getIn(['query', '$match']).
const wrapQuery = (query: unknown): IMap => mapFromEntries([['query', query]]);

export interface PipelinesFromQueriesArgs {
  /** Séries : objets `{ $match, label?, color? }` (valeurs JSON). */
  queries: readonly unknown[];
  /** Axes « dépliés » (unflattenAxes) et désérialisés : `{ group, value, operator, xValue, … }`. */
  axes: Record<string, unknown>;
  type: unknown;
  previewPeriod: unknown;
  /** Nom IANA ou décalage de l'interface (« +03:00 »). */
  timezone: unknown;
  benchmarkingEnabled?: unknown;
  /** Instant de référence, tronqué à la minute (UTC). */
  now: Now;
}

/**
 * Pipelines de toutes les séries. Avec la comparaison (benchmarkingEnabled), chaque série donne deux
 * entrées consécutives : période courante, puis période précédente.
 * Les entrées sont des valeurs JSON (comme `fromJS` à l'origine) ; le résultat est du JSON simple.
 */
export const pipelinesFromQueries = (args: PipelinesFromQueriesArgs): VisualisationPipelines => {
  const axes = fromJS(args.axes);
  if (!isMap(axes)) throw new TypeError('axes doit être un objet');
  return toJS(pipelinesFromQueriesInternal({ ...args, queries: fromJS(args.queries), axes })) as VisualisationPipelines;
};

export interface PipelineFromQueryArgs extends Omit<PipelinesFromQueriesArgs, 'queries'> {
  /** Une série `{ $match, … }`. */
  query: unknown;
}

/** Pipeline(s) d'une seule série (période courante, ou précédente si benchmarkingEnabled). */
export const pipelineFromQuery = (args: PipelineFromQueryArgs): unknown => {
  const axes = fromJS(args.axes);
  if (!isMap(axes)) throw new TypeError('axes doit être un objet');
  const currentMoment = moment.utc(new Date(args.now).getTime()).startOf('minute');
  return toJS(pipelineFromQueryInternal({ ...args, query: wrapQuery(fromJS(args.query)), axes, currentMoment }));
};

export { pipelinesFromQueriesInternal };
