// Portage de legacy/ui/src/utils/visualisations/aggregationGroup/grouper/index.spec.js, plus quelques
// cas du compteur (legacy/ui/src/utils/visualisations/aggregationGroup/counter).
import { describe, expect, it } from 'vitest';
import { counter } from './counter.js';
import { grouper } from './grouper.js';

const stageNames = (stages: Record<string, unknown>[]): string[] => stages.map((stage) => Object.keys(stage)[0] ?? '');

describe('aggregationGroup grouper', () => {
  it('ajoute une étape $unwind pour un groupe contextActivities', () => {
    const result = grouper({
      valueType: 'statements',
      groupType: 'statement.context.contextActivities.category',
      operatorType: 'uniqueCount',
      timezone: 'America/Los_Angeles',
    });
    expect(result[1]?.$unwind).toEqual({ path: '$statement.context.contextActivities.category' });
  });

  describe('groupe « date »', () => {
    const result = grouper({ valueType: 'statements', groupType: 'date', operatorType: 'uniqueCount', timezone: undefined });

    it('a les bonnes étapes', () => {
      expect(stageNames(result)).toEqual(['$project', '$group', '$sort', '$limit', '$project']);
    });
  });

  describe('groupe commençant par « statement.context.contextActivities. »', () => {
    const result = grouper({ valueType: 'statements', groupType: 'statement.context.contextActivities.category', operatorType: 'uniqueCount', timezone: undefined });

    it('a la bonne étape $unwind', () => {
      expect(result[1]?.$unwind).toEqual({ path: '$statement.context.contextActivities.category' });
    });
  });

  describe('groupe commençant par « persona.import. »', () => {
    const result = grouper({ valueType: 'statements', groupType: 'persona.import.abcde', operatorType: 'uniqueCount', timezone: undefined });

    it('a les bonnes étapes', () => {
      expect(stageNames(result)).toEqual(['$lookup', '$match', '$unwind', '$match', '$project', '$group', '$sort', '$limit', '$project']);
    });

    it('a le bon contenu', () => {
      expect(result[0]?.$lookup).toEqual({
        from: 'personaAttributes',
        as: 'personaAttrs',
        let: { personaId: '$person._id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$personaId', '$$personaId'] },
                  { $eq: ['$key', 'abcde'] },
                ],
              },
            },
          },
        ],
      });
      expect(result[1]?.$match).toEqual({ personaAttrs: { $exists: true } });
      expect(result[2]?.$unwind).toEqual({ path: '$personaAttrs' });
      expect(result[3]?.$match).toEqual({ 'personaAttrs.key': 'abcde' });
      expect(result[4]?.$project).toEqual({ group: '$personaAttrs.value', model: '$personaAttrs.value' });
    });
  });

  it('filtre le type de définition d\'un contextActivities choisi', () => {
    const result = grouper({
      valueType: 'people',
      groupType: 'statement.context.contextActivities.grouping',
      operatorType: 'uniqueCount',
      timezone: 'UTC',
      contextActivityDefinitionType: 'http://id.tincanapi.com/activitytype/school-assignment',
    });
    expect(stageNames(result)).toEqual(['$match', '$unwind', '$match', '$project', '$group', '$group', '$sort', '$limit', '$project']);
    expect(result[2]?.$match).toEqual({ 'statement.context.contextActivities.grouping.definition.type': 'http://id.tincanapi.com/activitytype/school-assignment' });
  });

  it('regroupe par période pour les opérateurs unique* modificateurs', () => {
    const result = grouper({ valueType: 'statements', groupType: 'month', operatorType: 'uniqueAverage', timezone: 'Europe/Paris' });
    expect(result[2]).toEqual({
      $group: {
        _id: { $month: { date: '$timestamp', timezone: 'Europe/Paris' } },
        count: { $avg: '$count' },
        date: { $first: '$date' },
        timestamp: { $first: '$timestamp' },
        model: { $first: '$model' },
      },
    });
  });

  it('lève une TypeError si le groupe n\'est pas une chaîne (comme groupType.startsWith)', () => {
    expect(() => grouper({ valueType: 'statements', groupType: null, operatorType: 'uniqueCount', timezone: 'UTC' })).toThrow(TypeError);
  });
});

describe('aggregationGroup counter', () => {
  it('compte les statements', () => {
    expect(counter({ valueType: 'statements', groupType: 'date', operatorType: 'uniqueCount', timezone: 'UTC' })).toEqual([
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
  });

  it('somme une valeur numérique', () => {
    expect(counter({ valueType: 'raw', groupType: 'date', operatorType: 'count', timezone: 'UTC' })).toEqual([
      { $match: { 'statement.result.score.raw': { $exists: true } } },
      { $project: { value: '$statement.result.score.raw' } },
      { $group: { _id: null, count: { $sum: '$value' }, value: { $first: '$value' } } },
    ]);
  });
});
