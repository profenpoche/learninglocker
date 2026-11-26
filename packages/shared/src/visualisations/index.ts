// Construction des pipelines d'agrégation des visualisations (portage de legacy/ui/src/utils/visualisations).
export * from './constants.js';
export { buildVisualisationPipelines, type BuildVisualisationPipelinesOptions } from './build.js';
export {
  pipelineFromQuery,
  pipelinesFromQueries,
  type Now,
  type PipelineFromQueryArgs,
  type PipelinesFromQueriesArgs,
  type VisualisationPipelines,
} from './pipelines.js';
export { reviveVisualisation } from './revive.js';
export { axesToJsList, deserialiseAxes, unflattenAxes } from './axes.js';
export { grouper, type GrouperArgs } from './grouper.js';
export { counter, type CounterArgs } from './counter.js';
export { isContextActivity, type Stage } from './helpers.js';
export { GROUP_OPTS, OPERATOR_OPTS, UNIQUENESS_OPS, UNIQUENESS_VALUE_OPTS, VALUE_OPTS, getTypeOpts, type OptionModel } from './localOptions.js';
