// Test différentiel des utilitaires du query builder contre le vrai code legacy
// (fixture queries.json.gz, tools/oracle/libs.mjs).
import { describe, expect, it } from 'vitest';
import { compareCases, loadOracle } from '../testing/oracle.js';
import { addCriterionFromSection, addTokenToQuery, deleteCriterion, getCriteria, has$dte, queryToStringList } from './queries.js';

type Input = Record<string, unknown> & { fn: string; query: unknown };

const oracle = loadOracle<Input>('queries');

const run = (input: Input): unknown => {
  switch (input.fn) {
    // Format de la fixture : entrySeq().toJS(), soit [[clé, critère], …].
    case 'getCriteria': return getCriteria(input.query).map(({ key, criterion }) => [key, criterion]);
    case 'queryToStringList': return queryToStringList(input.query);
    case 'has$dte': return has$dte(input.query);
    case 'deleteCriterion': return deleteCriterion(input.query, input.key as { criterionLabel: unknown; criteriaPath: unknown });
    case 'addTokenToQuery': return addTokenToQuery(input.query, input.keyPath, input.token);
    case 'addCriterionFromSection': return addCriterionFromSection(input.query, input.criterion, input.section);
    default: throw new Error(`fonction inconnue : ${input.fn}`);
  }
};

describe('query builder : oracle legacy', () => {
  it('reproduit tous les cas (ordre des critères compris)', async () => {
    expect(oracle.cases.length).toBeGreaterThan(1000);
    const { identical, failures } = await compareCases(oracle.cases, run);
    expect(failures, `${String(identical)} / ${String(oracle.cases.length)} cas identiques\n${failures.slice(0, 20).join('\n')}`).toEqual([]);
  });
});
