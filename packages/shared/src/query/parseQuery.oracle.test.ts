// Test différentiel de parseQuery contre le vrai code legacy (fixture parse-query.json.gz, produite
// par tools/oracle/libs.mjs). Faux getScopeFilter et persona-service identiques à ceux du serveur
// d'oracle (tools/oracle/legacy/lib-oracle-server.js).
import { describe, expect, it } from 'vitest';
import { compareCases, loadOracle, tag } from '../testing/oracle.js';
import { parseQuery, type QueryDependencies } from './parseQuery.js';
import { defaultObjectIdFactory } from './values.js';

interface Attribute { key: string; value: unknown; personaId?: string | null; organisation?: string }
interface Input { pipeline?: unknown; options?: unknown; optionsUndefined?: boolean; attributes: Attribute[] }

const ORG = '6b083fe419b92523f89d6725';

export const stubDependencies = (attributes: readonly Attribute[], calls: unknown[]): QueryDependencies => ({
  objectId: defaultObjectIdFactory,
  getScopeFilter: (request) => {
    calls.push({ fn: 'getScopeFilter', modelName: request.modelName, actionName: request.actionName, allowDashboardAccess: request.allowDashboardAccess });
    if ((request.authInfo as { scopeError?: unknown } | null)?.scopeError) return Promise.reject(new Error('portée refusée'));
    return Promise.resolve({ organisation: defaultObjectIdFactory.fromHex(ORG), model: request.modelName, $comment: 'scope' });
  },
  getPersonaAttributes: (request) => {
    calls.push({ fn: 'getAttributes', filter: request.filter, organisation: request.organisation, limit: request.limit, maxTimeMS: request.maxTimeMS });
    if (request.filter.key === 'boom') return Promise.reject(new Error('persona-service indisponible'));
    const edges = attributes
      .filter((a) => a.key === request.filter.key
        && JSON.stringify(a.value) === JSON.stringify(request.filter.value)
        && (a.organisation === undefined || a.organisation === String(request.organisation)))
      .map((a) => {
        const node: Record<string, unknown> = {};
        if ('personaId' in a) node.personaId = typeof a.personaId === 'string' ? defaultObjectIdFactory.fromHex(a.personaId) : a.personaId;
        return { node };
      });
    return Promise.resolve({ edges });
  },
});

const oracle = loadOracle<Input>('parse-query');

const run = async (input: Input): Promise<unknown> => {
  const calls: unknown[] = [];
  const options = input.optionsUndefined ? undefined : 'options' in input ? input.options : {};
  const result = await parseQuery(input.pipeline, options, stubDependencies(input.attributes, calls));
  // L'ordre des appels concurrents dépend de l'ordonnancement des promesses (Node 10 ≠ Node 24) : on les trie.
  const sortCalls = (list: unknown[]): unknown[] => list.map((c) => JSON.stringify(tag(c))).sort().map((c) => JSON.parse(c) as unknown);
  return { result: tag(result), calls: sortCalls(calls) };
};

describe('parseQuery : oracle legacy', () => {
  it('reproduit tous les cas (résultat et appels aux dépendances)', async () => {
    expect(oracle.cases.length).toBeGreaterThan(1000);
    const sorted = oracle.cases.map((c) => {
      const output = c.output as { result: unknown; calls: unknown[] };
      return { ...c, output: { result: output.result, calls: output.calls.map((x) => JSON.stringify(x)).sort().map((x) => JSON.parse(x) as unknown) } };
    });
    const { identical, failures } = await compareCases(sorted, run);
    expect(failures, `${String(identical)} / ${String(oracle.cases.length)} cas identiques\n${failures.slice(0, 15).join('\n')}`).toEqual([]);
  }, 60_000);
});
