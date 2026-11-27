// Test différentiel des preSave/reviver du front contre le vrai code legacy (fixture schemas.json.gz,
// tools/oracle/libs.mjs) : documents réels de la base de test et cas limites.
import { describe, expect, it } from 'vitest';
import { compareCases, loadOracle, tag } from '../testing/oracle.js';
import { preSave, revive } from './schemas.js';

interface Input { route: 'presave' | 'revive'; schema: string; doc?: unknown; props?: unknown }

const oracle = loadOracle<Input>('schemas');

const run = (input: Input): unknown => tag(input.route === 'revive' ? revive(input.schema, input.doc) : preSave(input.schema, input.props));

describe('schémas du front : oracle legacy', () => {
  it('reproduit tous les cas (ordre des clés compris)', async () => {
    expect(oracle.cases.length).toBeGreaterThan(500);
    const { identical, failures } = await compareCases(oracle.cases, run);
    expect(failures, `${String(identical)} / ${String(oracle.cases.length)} cas identiques\n${failures.slice(0, 25).join('\n')}`).toEqual([]);
  });
});

// Portage de legacy/ui/src/utils/schemas.spec.js (preSave du schéma visualisation).
describe('preSave visualisation', () => {
  it('sérialise les objets d’axes, pas axesxOperator', () => {
    const result = preSave('visualisation', { axesxValue: { value: 99 }, axesxOperator: 'testOperator' }) as Record<string, unknown>;
    expect(result.axesxValue).toBe(JSON.stringify({ value: 99 }));
    expect(result.axesxOperator).toBe('testOperator');
    expect(result.filters).toEqual(['{"$match":{}}']);
    expect(result.axes).toBe('{}');
  });

  it('revive parse axesxValue', () => {
    expect((revive('visualisation', { axesxValue: JSON.stringify({ value: 99 }) }) as Record<string, unknown>).axesxValue).toEqual({ value: 99 });
  });
});
