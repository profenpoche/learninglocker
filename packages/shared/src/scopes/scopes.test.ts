// Portage de legacy/lib/helpers/tests/scopes-test.js et legacy/ui/src/pages/SettingsRolesPage/RoleForm.spec.js.
import { describe, expect, it } from 'vitest';
import {
  ALL,
  EDIT_ALL_VISUALISATIONS,
  EDIT_PUBLIC_VISUALISATIONS,
  VIEW_ALL_VISUALISATIONS,
  VIEW_PUBLIC_VISUALISATIONS,
  orgScopes,
} from './constants.js';
import { canCreateOrganisations, generateNewScopes, getLabel, getScopeDependencies, getScopeDependents, groupScopes } from './scopes.js';

describe('scopes helper', () => {
  it('dépendances de EDIT_ALL_VISUALISATIONS', () => {
    expect(new Set(getScopeDependencies()(EDIT_ALL_VISUALISATIONS))).toEqual(new Set([VIEW_ALL_VISUALISATIONS, EDIT_PUBLIC_VISUALISATIONS, VIEW_PUBLIC_VISUALISATIONS]));
  });

  it('dépendants de EDIT_ALL_VISUALISATIONS', () => {
    expect(getScopeDependents()(EDIT_ALL_VISUALISATIONS)).toEqual([ALL]);
  });
});

describe('RoleForm', () => {
  it('groupe les scopes', () => {
    const result = groupScopes();
    expect(result['']?.[0]).toBe('all');
    expect(result['org/all/statementForwarding']?.[0]).toBe('org/all/statementForwarding/view');
  });

  it('décocher retire les scopes dépendants', () => {
    expect(generateNewScopes([EDIT_PUBLIC_VISUALISATIONS, VIEW_PUBLIC_VISUALISATIONS], EDIT_PUBLIC_VISUALISATIONS, false)).toEqual([]);
  });

  it('décocher retire les dépendances si toutes sont cochées, et leurs dépendants', () => {
    expect(generateNewScopes([EDIT_ALL_VISUALISATIONS, VIEW_ALL_VISUALISATIONS, EDIT_PUBLIC_VISUALISATIONS, VIEW_PUBLIC_VISUALISATIONS], EDIT_PUBLIC_VISUALISATIONS, false)).toEqual([]);
  });

  it('ne retire pas les dépendances si seules certaines sont cochées', () => {
    const result = generateNewScopes([...orgScopes], EDIT_PUBLIC_VISUALISATIONS, false);
    expect(result.filter((s) => [ALL, EDIT_ALL_VISUALISATIONS, VIEW_ALL_VISUALISATIONS, EDIT_PUBLIC_VISUALISATIONS, VIEW_PUBLIC_VISUALISATIONS].includes(s))).toEqual([]);
    expect(generateNewScopes(result, EDIT_PUBLIC_VISUALISATIONS, false)).toHaveLength(result.length);
  });

  it('cocher ajoute les dépendances', () => {
    expect(new Set(generateNewScopes([], EDIT_PUBLIC_VISUALISATIONS, true))).toEqual(new Set([EDIT_PUBLIC_VISUALISATIONS, VIEW_PUBLIC_VISUALISATIONS]));
  });

  it('libellés des cases', () => {
    expect(getLabel('org/all/persona/manage')).toBe('Manage');
    expect(getLabel('a/statementForwarding')).toBe('Statement Forwarding');
  });
});

describe('canCreateOrganisations', () => {
  it('« all » ne suffit que si la création n’est pas restreinte', () => {
    expect(canCreateOrganisations([ALL])).toBe(false);
    expect(canCreateOrganisations([ALL], { restrictCreateOrganisation: false })).toBe(true);
  });
});
