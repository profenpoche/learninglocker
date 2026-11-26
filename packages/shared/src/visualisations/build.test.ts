// Sélection des pipelines d'une visualisation (legacy/ui/src/redux/modules/visualise.js,
// visualisationPipelinesSelector) ; reprend l'idée de legacy/ui/src/redux/modules/visualise.spec.js.
import { describe, expect, it } from 'vitest';
import { buildVisualisationPipelines } from './build.js';
import { pipelinesFromQueries } from './pipelines.js';

const NOW = '2026-11-26T14:19:37.123Z';
const verbFilter = '{"$match":{"statement.verb.id":{"$in":["http://adlnet.gov/expapi/verbs/passed"]}}}';

describe('buildVisualisationPipelines', () => {
  it('déplie les axes avant de construire les pipelines (visualise.spec)', () => {
    const stored = { type: 'XVSY', filters: ['{}'], axesxValue: '{"optionKey":"scaled"}', axesxOperator: 'max' };
    const [series] = buildVisualisationPipelines(stored, { now: NOW }) as unknown[][][];
    expect(series?.[0]).toContainEqual({ $project: { group: { $dateToString: { date: '$timestamp', format: '%Y-%m-%d', timezone: 'UTC' } }, value: '$statement.result.score.scaled', model: { $dateToString: { date: '$timestamp', format: '%Y-%m-%d', timezone: 'UTC' } } } });
  });

  it('tronque now à la minute et applique le fuseau de l\'organisation à défaut', () => {
    const [series] = buildVisualisationPipelines({ type: 'COUNTER', filters: ['{}'] }, { now: NOW, orgTimezone: 'Europe/Paris' }) as unknown[][][];
    expect(series?.[0]?.[0]).toEqual({ $match: { timestamp: { $gte: { $dte: '2026-11-19T14:19:00.000Z' } } } });
  });

  it('enveloppe chaque série avec le filtre de partage', () => {
    const [series] = buildVisualisationPipelines({ type: 'COUNTER', filters: [verbFilter] }, { now: NOW, dashboardFilter: { a: 1 } }) as unknown[][][];
    expect(series?.[0]?.[1]).toEqual({ $match: { $and: [{ 'statement.verb.id': { $in: ['http://adlnet.gov/expapi/verbs/passed'] } }, { a: 1 }] } });
  });

  it('accepte la liste de filtres du front (partage + filtre d\'URL)', () => {
    const stored = { type: 'COUNTER', filters: [verbFilter] };
    const single = buildVisualisationPipelines(stored, { now: NOW, dashboardFilter: { a: 1 } });
    expect(buildVisualisationPipelines(stored, { now: NOW, dashboardFilters: [{ a: 1 }] })).toEqual(single);
    const [series] = buildVisualisationPipelines(stored, { now: NOW, dashboardFilters: [{ a: 1 }, { b: 2 }] }) as unknown[][][];
    expect(series?.[0]?.[1]).toEqual({ $match: { $and: [{ 'statement.verb.id': { $in: ['http://adlnet.gov/expapi/verbs/passed'] } }, { a: 1 }, { b: 2 }] } });
  });

  it('double les séries avec la comparaison, période précédente en second', () => {
    const out = buildVisualisationPipelines({ type: 'COUNTER', filters: ['{}', '{}'], benchmarkingEnabled: true, previewPeriod: 'LAST_24_HOURS' }, { now: NOW }) as unknown[][][];
    expect(out).toHaveLength(4);
    expect(out[1]?.[0]?.[0]).toEqual({ $match: { timestamp: { $gte: { $dte: '2026-11-24T14:19:00.000Z' }, $lte: { $dte: '2026-11-25T14:19:00.000Z' } } } });
  });

  it('renvoie le $match des séries quand le type est absent', () => {
    expect(buildVisualisationPipelines({ filters: [verbFilter, '{}'] }, { now: NOW })).toEqual([
      { 'statement.verb.id': { $in: ['http://adlnet.gov/expapi/verbs/passed'] } },
      {},
    ]);
  });

  it('sans séries, aucun pipeline', () => {
    expect(buildVisualisationPipelines({ type: 'PIE' }, { now: NOW })).toEqual([]);
  });
});

describe('pipelinesFromQueries', () => {
  it('construit les pipelines à partir de séries et d\'axes déjà désérialisés', () => {
    const out = pipelinesFromQueries({
      queries: [{ $match: {} }],
      axes: { group: { optionKey: 'people' }, value: { optionKey: 'statements' }, operator: 'uniqueCount' },
      type: 'LEADERBOARD',
      previewPeriod: 'TODAY',
      timezone: 'Asia/Kolkata',
      now: Date.UTC(2026, 5, 14, 18, 30, 59),
    });
    expect(out).toEqual([[[
      { $match: { timestamp: { $gte: { $dte: '2026-06-14T18:30:00.000Z' } } } },
      { $match: { 'person._id': { $exists: true } } },
      { $project: { group: '$person._id', model: '$person.display' } },
      { $group: { _id: '$group', count: { $sum: 1 }, group: { $first: '$group' }, model: { $first: '$model' } } },
      { $sort: { count: -1 } },
      { $limit: 10000 },
      { $project: { _id: 1, count: 1, model: 1 } },
    ]]]);
  });
});
