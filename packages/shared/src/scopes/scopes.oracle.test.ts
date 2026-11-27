// Test différentiel des scopes contre le vrai code legacy (fixture scopes.json.gz, tools/oracle/libs.mjs).
import { describe, expect, it } from 'vitest';
import { compareCases, loadOracle, tag } from '../testing/oracle.js';
import * as constants from './constants.js';
import {
  canCreateOrganisations,
  canViewModel,
  generateNewScopes,
  getLabel,
  getOrganisationTokenScopes,
  getRowLabel,
  getScopeDependencies,
  getScopeDependents,
  groupScopes,
  parseBooleanEnv,
} from './scopes.js';

type Input = Record<string, unknown> & { fn: string };

const oracle = loadOracle<Input>('scopes');

const run = (input: Input): unknown => {
  const scopes = input.scopes as string[] | undefined;
  switch (input.fn) {
    case 'constants': {
      const exported = constants as unknown as Record<string, unknown>;
      const expected = oracle.cases.find((c) => c.id === 'constants')?.output as { constants: Record<string, unknown>; orgConstants: Record<string, unknown> };
      return {
        orgScopes: constants.orgScopes,
        roleGroupNames: constants.roleGroupNames,
        constants: Object.fromEntries(Object.keys(expected.constants).map((k) => [k, exported[k]])),
        orgConstants: Object.fromEntries(Object.keys(expected.orgConstants).map((k) => [k, exported[k]])),
      };
    }
    case 'dependencies': return tag(getScopeDependencies(scopes)(input.scope as string));
    case 'dependents': return tag(getScopeDependents(scopes)(input.scope));
    case 'generateNewScopes': return generateNewScopes(input.oldScopes as string[], input.scope as string, input.checked as boolean);
    case 'groupScopes': return groupScopes(scopes);
    case 'getLabel': return getLabel(input.key as string);
    case 'getRowLabel': return tag(getRowLabel(input.key as string));
    case 'getXapiScopes': return 'deleteStatementsEnabled' in input ? constants.getXapiScopes(input.deleteStatementsEnabled) : constants.getXapiScopes();
    case 'canViewModel': return canViewModel(input.modelName as string, input.activeScopes);
    case 'canCreateOrganisations': {
      const options = input.options as { RESTRICT_CREATE_ORGANISATION?: unknown };
      return canCreateOrganisations(input.activeScopes, 'RESTRICT_CREATE_ORGANISATION' in options ? { restrictCreateOrganisation: options.RESTRICT_CREATE_ORGANISATION } : {});
    }
    case 'boolean': return parseBooleanEnv(input.value);
    case 'orgTokenScopes': return getOrganisationTokenScopes(input.roleScopes as string[][], input.userScopes as string[]);
    default: throw new Error(`fonction inconnue : ${input.fn}`);
  }
};

describe('scopes : oracle legacy', () => {
  it('reproduit tous les cas (ordre des listes compris)', async () => {
    expect(oracle.cases.length).toBeGreaterThan(1000);
    const { identical, failures } = await compareCases(oracle.cases, run);
    expect(failures, `${String(identical)} / ${String(oracle.cases.length)} cas identiques\n${failures.slice(0, 15).join('\n')}`).toEqual([]);
  });
});
