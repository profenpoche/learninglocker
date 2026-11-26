// Pipelines d'une visualisation stockée, tels que le front les envoie à /api/statements/aggregate.
// Code d'origine : visualisationPipelinesSelector dans legacy/ui/src/redux/modules/visualise.js
// (fuseau, filtre de partage de dashboard, dépliage des axes), et sa reproduction de référence
// tools/seed/legacy/presave-server.js (route POST /pipelines).

import { unflattenAxesInternal } from './axes.js';
import { fromJS, get, isList, isMap, mapFromEntries, toJS, type IMap } from './immutable.js';
import { pipelinesFromQueriesInternal, type Now, type VisualisationPipelines } from './pipelines.js';
import { reviveVisualisationInternal } from './revive.js';

export interface BuildVisualisationPipelinesOptions {
  /** Instant de référence (tronqué à la minute). Aucune horloge globale n'est lue. */
  now: Now;
  /** Fuseau de l'organisation, utilisé si la visualisation n'en a pas ; 'UTC' à défaut. */
  orgTimezone?: string | null;
  /**
   * Filtre de partage du dashboard (objet requête, déjà parsé). S'il est présent (valeur « vraie »),
   * chaque série devient `{ $match: { $and: [série.$match, dashboardFilter] } }`.
   * Le front l'applique toujours (`{}` hors partage) ; checkDashboardAuth aussi, avec le filtre du partage.
   */
  dashboardFilter?: unknown;
  /**
   * Variante « liste » du front (shareableDashboardFilterSelector) : `[filtre du partage]`, ou
   * `[filtre du partage, filtre d'URL]` en mode ANY/JWT. Prioritaire sur `dashboardFilter`.
   */
  dashboardFilters?: readonly unknown[];
}

// vFilter.get('$match', new Map()) : la série doit avoir une méthode get (Map ou List).
const seriesMatch = (series: unknown): unknown => {
  if (isMap(series)) return get(series, '$match', mapFromEntries([]));
  if (isList(series)) return mapFromEntries([]);
  throw new TypeError('vFilter.get is not a function');
};

/**
 * Pipelines d'agrégation d'une visualisation à partir du document stocké (champs `filters` et `axes*`
 * en chaînes JSON, comme en base ou dans la réponse de GET /api/v2/visualisation/:id).
 *
 * - fuseau = `visualisation.timezone || orgTimezone || 'UTC'` ;
 * - une entrée par série (deux avec `benchmarkingEnabled` : période courante puis précédente) ;
 * - résultat identique, ordre des clés compris, à celui du front React d'origine.
 *
 * Lève une erreur dans les cas où le front d'origine échouait (voir les fixtures d'oracle).
 */
export const buildVisualisationPipelines = (storedVisualisation: Record<string, unknown>, options: BuildVisualisationPipelinesOptions): VisualisationPipelines => {
  const visualisation = reviveVisualisationInternal(storedVisualisation);
  if (!isMap(visualisation)) throw new TypeError('visualisation.get is not a function');

  let filters: unknown[] | null = null;
  if (options.dashboardFilters) {
    filters = options.dashboardFilters.map((filter: unknown) => fromJS(filter));
  } else if (options.dashboardFilter) {
    filters = [fromJS(options.dashboardFilter)];
  }

  const timezone = get(visualisation, 'timezone') || options.orgTimezone || 'UTC';

  const storedFilters = get(visualisation, 'filters', []);
  if (!isList(storedFilters)) throw new TypeError('filters.map is not a function');
  const queries = storedFilters.map((series: unknown) => {
    if (!filters) return series;
    return mapFromEntries([['$match', mapFromEntries([['$and', [seriesMatch(series), ...filters]]])]]);
  });

  const axes: IMap = unflattenAxesInternal(visualisation);
  return toJS(pipelinesFromQueriesInternal({
    queries,
    axes,
    type: get(visualisation, 'type'),
    previewPeriod: get(visualisation, 'previewPeriod'),
    timezone,
    benchmarkingEnabled: get(visualisation, 'benchmarkingEnabled', false),
    now: options.now,
  })) as VisualisationPipelines;
};
