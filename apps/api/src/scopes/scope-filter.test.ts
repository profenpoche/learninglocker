// Tests des filtres de droits, portés de legacy/lib/services/auth/tests/modelFilters/*-test.js et de
// leurs utilitaires (legacy/lib/services/auth/tests/utils/*.js). Mêmes jetons, mêmes attentes ;
// la base est remplacée par des dépendances factices (aucune organisation, aucun rôle, aucun dashboard).
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  ALL, EDIT_ALL_DASHBOARDS, EDIT_ALL_DOWNLOADS, EDIT_ALL_EXPORTS, EDIT_ALL_QUERIES, EDIT_ALL_STATEMENTFORWARDING,
  EDIT_ALL_VISUALISATIONS, EDIT_PUBLIC_DASHBOARDS, EDIT_PUBLIC_DOWNLOADS, EDIT_PUBLIC_EXPORTS, EDIT_PUBLIC_QUERIES,
  EDIT_PUBLIC_STATEMENTFORWARDING, EDIT_PUBLIC_VISUALISATIONS, MANAGE_ALL_CLIENTS, MANAGE_ALL_ORGANISATIONS,
  MANAGE_ALL_PERSONAS, MANAGE_ALL_ROLES, MANAGE_ALL_STORES, MANAGE_ALL_USERS, parseQuery, SITE_ADMIN,
  VIEW_ALL_DASHBOARDS, VIEW_ALL_DOWNLOADS, VIEW_ALL_EXPORTS, VIEW_ALL_QUERIES, VIEW_ALL_STATEMENTFORWARDING,
  VIEW_ALL_VISUALISATIONS, VIEW_PUBLIC_DASHBOARDS, VIEW_PUBLIC_DOWNLOADS, VIEW_PUBLIC_EXPORTS, VIEW_PUBLIC_QUERIES,
  VIEW_PUBLIC_STATEMENTFORWARDING, VIEW_PUBLIC_VISUALISATIONS, VIEW_SHAREABLE_DASHBOARD, XAPI_ALL,
  XAPI_STATEMENTS_DELETE, XAPI_STATEMENTS_READ_MINE, XAPI_STATEMENTS_WRITE,
} from '@ll/shared';
import type { AuthInfo, TokenPayload } from '../auth/auth-info.js';
import { NoAccessError } from '../http/request-errors.js';
import { getScopeFilter, getScopeSelect, USER_MANAGER_SELECT, USER_SELECT, type ScopeDeps } from './scope-filter.js';
import { legacyObjectId, objectIdFactory } from './scope.service.js';

const { ObjectId } = mongoose.Types;

// utils/constants.js
const TEST_ORG_ID = new ObjectId();
const TEST_USER_ID = new ObjectId();
const TEST_OWNER_ID = new ObjectId();
const TEST_DASH_ID = new ObjectId();
const TEST_CLIENT_ID = new ObjectId();
const TEST_ORG_FILTER = { organisation: TEST_ORG_ID };
const TEST_OWNER_FILTER = { owner: TEST_USER_ID };
const TEST_PRIVATE_FILTER = { $and: [TEST_OWNER_FILTER, TEST_ORG_FILTER] };
const TEST_PUBLIC_FILTER = { $or: [{ $and: [{ isPublic: true }, TEST_ORG_FILTER] }, TEST_PRIVATE_FILTER] };
const TEST_DASH_FILTER = { _id: { $in: [] } };
const TEST_DASH_DASHBOARD_FILTER = { _id: TEST_DASH_ID };

const makeDeps = (overrides: Partial<ScopeDeps> = {}): ScopeDeps => {
  const deps: ScopeDeps = {
    objectId: legacyObjectId,
    findOrganisation: () => Promise.resolve(null),
    findRoleOrganisations: () => Promise.resolve([]),
    dashboardVisualisationIds: () => Promise.resolve([]),
    parseQuery: (filter, authInfo) => parseQuery(filter, { authInfo }, {
      getScopeFilter: (request) => getScopeFilter(deps, request as Parameters<typeof getScopeFilter>[1]),
      getPersonaAttributes: () => Promise.resolve({ edges: [] }),
      objectId: objectIdFactory,
    }),
    enableStatementDeletion: true,
    restrictCreateOrganisation: true,
    ...overrides,
  };
  return deps;
};
const deps = makeDeps();

// utils/create*.js
const createUser = (userId: mongoose.Types.ObjectId) => ({ _id: userId, organisations: [TEST_ORG_ID] });
const createClient = (scopes: string[] = []) => ({ _id: TEST_CLIENT_ID, organisation: TEST_ORG_ID, api: { basic_key: 'key', basic_secret: 'secret' }, scopes });
const createOrgToken = (scopes: string[]): TokenPayload => ({ tokenType: 'organisation', tokenId: TEST_ORG_ID.toString(), scopes, userId: TEST_USER_ID.toString(), provider: 'native', filter: { test: 1 } });
const createClientToken = (scopes: string[] = []): TokenPayload => ({ tokenType: 'client', provider: 'native', scopes });
const createDashToken = (scopes: string[]): TokenPayload => ({ tokenId: TEST_DASH_ID.toString(), tokenType: 'dashboard', provider: 'native', filter: { test: 1 }, scopes });
const createUserToken = (userId: mongoose.Types.ObjectId, scopes: string[] = []): TokenPayload => ({ userId: userId.toString(), provider: 'native', scopes, tokenType: 'user', tokenId: userId.toString() });

// utils/getModelScopeFilter.js
const filterFor = (modelName: string, actionName: string, token: TokenPayload, user?: object, client?: object, d = deps) =>
  getScopeFilter(d, { modelName, actionName, authInfo: { token, user, client } as AuthInfo });

const label = (scopes: string[]) => (scopes.length === 0 ? 'no scopes' : `${scopes.join(', ')} scope`);
const ACTIONS = ['view', 'edit', 'create', 'delete'] as const;

const testOrgScopeFilter = (modelName: string, actionName: string, scopes: string[], expected: unknown) => {
  it(`${actionName} avec un jeton d'organisation (${label(scopes)}) sur ${modelName}`, async () => {
    expect(await filterFor(modelName, actionName, createOrgToken(scopes), createUser(TEST_USER_ID))).toEqual(expected);
  });
};
const testOrgScopeFilterError = (modelName: string, actionName: string, scopes: string[]) => {
  it(`${actionName} refusé avec un jeton d'organisation (${label(scopes)}) sur ${modelName}`, async () => {
    await expect(filterFor(modelName, actionName, createOrgToken(scopes), createUser(TEST_USER_ID))).rejects.toBeInstanceOf(NoAccessError);
  });
};
const testOrgScopeFilterOwner = (modelName: string, actionName: string, expected: unknown) => {
  it(`${actionName} pour le propriétaire (jeton d'organisation sans scope) sur ${modelName}`, async () => {
    expect(await filterFor(modelName, actionName, createOrgToken([]), createUser(TEST_OWNER_ID))).toEqual(expected);
  });
};
const testOrgScopeFilterOwnerError = (modelName: string, actionName: string) => {
  it(`${actionName} refusé au propriétaire (jeton d'organisation sans scope) sur ${modelName}`, async () => {
    await expect(filterFor(modelName, actionName, createOrgToken([]), createUser(TEST_OWNER_ID))).rejects.toBeInstanceOf(NoAccessError);
  });
};
const testOwnerScopeFilter = (modelName: string, actionName: string, expected: unknown) => {
  it(`${actionName} avec un jeton utilisateur sur ${modelName}`, async () => {
    expect(await filterFor(modelName, actionName, createUserToken(TEST_OWNER_ID), createUser(TEST_OWNER_ID))).toEqual(expected);
  });
};
const testOwnerScopeFilterError = (modelName: string, actionName: string) => {
  it(`${actionName} refusé avec un jeton utilisateur sur ${modelName}`, async () => {
    await expect(filterFor(modelName, actionName, createUserToken(TEST_OWNER_ID), createUser(TEST_OWNER_ID))).rejects.toBeInstanceOf(NoAccessError);
  });
};
const testSiteAdminScopeFilter = (modelName: string, actionName: string, expected: unknown) => {
  it(`${actionName} avec un jeton d'administrateur du site sur ${modelName}`, async () => {
    expect(await filterFor(modelName, actionName, createUserToken(TEST_OWNER_ID, [SITE_ADMIN]), createUser(TEST_OWNER_ID))).toEqual(expected);
  });
};
const testSiteAdminScopeFilterError = (modelName: string, actionName: string) => {
  it(`${actionName} refusé à l'administrateur du site (jeton utilisateur) sur ${modelName}`, async () => {
    await expect(filterFor(modelName, actionName, createUserToken(TEST_OWNER_ID, [SITE_ADMIN]), createUser(TEST_OWNER_ID))).rejects.toBeInstanceOf(NoAccessError);
  });
};
const testClientBasicScopeFilter = (modelName: string, actionName: string, scopes: string[], expected: unknown) => {
  it(`${actionName} avec un client Basic (${label(scopes)}) sur ${modelName}`, async () => {
    expect(await filterFor(modelName, actionName, createClientToken(scopes), undefined, createClient(scopes))).toEqual(expected);
  });
};
const testClientBasicScopeFilterError = (modelName: string, actionName: string, scopes: string[]) => {
  it(`${actionName} refusé à un client Basic (${label(scopes)}) sur ${modelName}`, async () => {
    await expect(filterFor(modelName, actionName, createClientToken(scopes), undefined, createClient())).rejects.toBeInstanceOf(NoAccessError);
  });
};
const testDashScopeFilter = (modelName: string, actionName: string, scopes: string[], expected: unknown) => {
  it(`${actionName} avec un jeton de dashboard sur ${modelName}`, async () => {
    expect(await filterFor(modelName, actionName, createDashToken(scopes), createUser(TEST_USER_ID))).toEqual(expected);
  });
};
const testAllActions = (modelName: string, scopes: string[], expected: unknown) => {
  for (const action of ACTIONS) testOrgScopeFilter(modelName, action, scopes, expected);
};

// utils/testShareableModel.js
const testShareableModel = ({ modelName, viewAllScopes, viewPublicScopes, editAllScopes, editPublicScopes }: {
  modelName: string; viewAllScopes: string[]; viewPublicScopes: string[]; editAllScopes: string[]; editPublicScopes: string[];
}) => {
  describe(`filtres de ${modelName} (modèle partageable)`, () => {
    testAllActions(modelName, [SITE_ADMIN], TEST_ORG_FILTER);
    testAllActions(modelName, [ALL], TEST_ORG_FILTER);
    testOrgScopeFilter(modelName, 'view', viewAllScopes, TEST_ORG_FILTER);
    for (const action of ['edit', 'create', 'delete']) testOrgScopeFilter(modelName, action, viewAllScopes, TEST_PRIVATE_FILTER);
    testOrgScopeFilter(modelName, 'view', viewPublicScopes, TEST_PUBLIC_FILTER);
    for (const action of ['edit', 'create', 'delete']) testOrgScopeFilter(modelName, action, viewPublicScopes, TEST_PRIVATE_FILTER);
    testAllActions(modelName, editAllScopes, TEST_ORG_FILTER);
    testAllActions(modelName, editPublicScopes, TEST_PUBLIC_FILTER);
    testAllActions(modelName, [], TEST_PRIVATE_FILTER);
    for (const action of ACTIONS) testOwnerScopeFilterError(modelName, action);
    testClientBasicScopeFilter(modelName, 'view', viewAllScopes, TEST_ORG_FILTER);
    testClientBasicScopeFilter(modelName, 'view', editAllScopes, TEST_ORG_FILTER);
    testClientBasicScopeFilterError(modelName, 'view', []);
    for (const action of ['edit', 'create', 'delete']) {
      testClientBasicScopeFilter(modelName, action, editAllScopes, TEST_ORG_FILTER);
      testClientBasicScopeFilterError(modelName, action, viewAllScopes);
      testClientBasicScopeFilterError(modelName, action, []);
    }
    for (const action of ACTIONS) testSiteAdminScopeFilter(modelName, action, {});
  });
};

// utils/testAdminModel.js
const testAdminModel = ({ modelName, viewAllScopes, editAllScopes }: { modelName: string; viewAllScopes: string[]; editAllScopes: string[] }) => {
  describe(`filtres de ${modelName} (modèle d'administration)`, () => {
    testAllActions(modelName, [SITE_ADMIN], TEST_ORG_FILTER);
    testAllActions(modelName, [ALL], TEST_ORG_FILTER);
    testOrgScopeFilter(modelName, 'view', viewAllScopes, TEST_ORG_FILTER);
    testOrgScopeFilter(modelName, 'view', editAllScopes, TEST_ORG_FILTER);
    testOrgScopeFilterError(modelName, 'view', []);
    for (const action of ['edit', 'create', 'delete']) {
      testOrgScopeFilter(modelName, action, editAllScopes, TEST_ORG_FILTER);
      testOrgScopeFilterError(modelName, action, []);
    }
    for (const action of ACTIONS) testOwnerScopeFilterError(modelName, action);
    testClientBasicScopeFilter(modelName, 'view', viewAllScopes, TEST_ORG_FILTER);
    testClientBasicScopeFilter(modelName, 'view', editAllScopes, TEST_ORG_FILTER);
    testClientBasicScopeFilterError(modelName, 'view', []);
    for (const action of ['edit', 'create', 'delete']) {
      testClientBasicScopeFilter(modelName, action, editAllScopes, TEST_ORG_FILTER);
      testClientBasicScopeFilterError(modelName, action, []);
    }
    for (const action of ACTIONS) testSiteAdminScopeFilter(modelName, action, {});
  });
};

// utils/testGlobalModel.js
const testGlobalModel = ({ modelName, editAllScopes }: { modelName: string; editAllScopes: string[] }) => {
  describe(`filtres de ${modelName} (modèle global)`, () => {
    testAllActions(modelName, [SITE_ADMIN], TEST_ORG_FILTER);
    testAllActions(modelName, [ALL], TEST_ORG_FILTER);
    testAllActions(modelName, editAllScopes, TEST_ORG_FILTER);
    testOrgScopeFilter(modelName, 'view', [], TEST_ORG_FILTER);
    for (const action of ['edit', 'create', 'delete']) {
      testOrgScopeFilterError(modelName, action, []);
      testOrgScopeFilterOwnerError(modelName, action);
    }
    for (const action of ACTIONS) testOwnerScopeFilterError(modelName, action);
    for (const action of ACTIONS) {
      testClientBasicScopeFilter(modelName, action, [ALL], TEST_ORG_FILTER);
      testClientBasicScopeFilter(modelName, action, editAllScopes, TEST_ORG_FILTER);
      testClientBasicScopeFilterError(modelName, action, []);
    }
    for (const action of ACTIONS) testSiteAdminScopeFilter(modelName, action, {});
  });
};

// modelFilters/*-test.js
testAdminModel({ modelName: 'client', viewAllScopes: [MANAGE_ALL_CLIENTS], editAllScopes: [MANAGE_ALL_CLIENTS] });
testAdminModel({ modelName: 'role', viewAllScopes: [MANAGE_ALL_ROLES, MANAGE_ALL_USERS], editAllScopes: [MANAGE_ALL_ROLES] });
testGlobalModel({ modelName: 'lrs', editAllScopes: [MANAGE_ALL_STORES] });
testGlobalModel({ modelName: 'persona', editAllScopes: [MANAGE_ALL_PERSONAS] });
testShareableModel({ modelName: 'download', viewAllScopes: [VIEW_ALL_DOWNLOADS], editAllScopes: [EDIT_ALL_DOWNLOADS], viewPublicScopes: [VIEW_PUBLIC_DOWNLOADS], editPublicScopes: [EDIT_PUBLIC_DOWNLOADS] });
testShareableModel({ modelName: 'export', viewAllScopes: [VIEW_ALL_EXPORTS], editAllScopes: [EDIT_ALL_EXPORTS], viewPublicScopes: [VIEW_PUBLIC_EXPORTS], editPublicScopes: [EDIT_PUBLIC_EXPORTS] });
testShareableModel({ modelName: 'query', viewAllScopes: [VIEW_ALL_QUERIES], editAllScopes: [EDIT_ALL_QUERIES], viewPublicScopes: [VIEW_PUBLIC_QUERIES], editPublicScopes: [EDIT_PUBLIC_QUERIES] });
testShareableModel({
  modelName: 'statementForwarding',
  viewAllScopes: [VIEW_ALL_STATEMENTFORWARDING], editAllScopes: [EDIT_ALL_STATEMENTFORWARDING],
  viewPublicScopes: [VIEW_PUBLIC_STATEMENTFORWARDING], editPublicScopes: [EDIT_PUBLIC_STATEMENTFORWARDING],
});

describe('dashboard-test', () => {
  testShareableModel({ modelName: 'dashboard', viewAllScopes: [VIEW_ALL_DASHBOARDS], editAllScopes: [EDIT_ALL_DASHBOARDS], viewPublicScopes: [VIEW_PUBLIC_DASHBOARDS], editPublicScopes: [EDIT_PUBLIC_DASHBOARDS] });
  testDashScopeFilter('dashboard', 'view', [VIEW_SHAREABLE_DASHBOARD], TEST_DASH_DASHBOARD_FILTER);
});

describe('visualisation-test', () => {
  testShareableModel({ modelName: 'visualisation', viewAllScopes: [VIEW_ALL_VISUALISATIONS], editAllScopes: [EDIT_ALL_VISUALISATIONS], viewPublicScopes: [VIEW_PUBLIC_VISUALISATIONS], editPublicScopes: [EDIT_PUBLIC_VISUALISATIONS] });
  testDashScopeFilter('visualisation', 'view', [VIEW_SHAREABLE_DASHBOARD], TEST_DASH_FILTER);
  it('jeton de dashboard : visualisations de ses widgets', async () => {
    const vizId = new ObjectId();
    const withWidgets = makeDeps({ dashboardVisualisationIds: () => Promise.resolve([vizId.toString()]) });
    expect(await filterFor('visualisation', 'view', createDashToken([VIEW_SHAREABLE_DASHBOARD]), undefined, undefined, withWidgets)).toEqual({ _id: { $in: [vizId] } });
  });
  it('jeton de dashboard : écriture refusée', async () => {
    await expect(filterFor('visualisation', 'edit', createDashToken([VIEW_SHAREABLE_DASHBOARD]))).rejects.toBeInstanceOf(NoAccessError);
  });
});

describe('organisation-test', () => {
  const modelName = 'organisation';
  const TEST_USER_ORGS_FILTER = { _id: { $in: [TEST_ORG_ID] } };
  const TEST_USER_NO_ORGS_FILTER = { _id: { $in: [] } };
  testAllActions(modelName, [SITE_ADMIN], {});
  testOrgScopeFilter(modelName, 'view', [ALL], TEST_USER_ORGS_FILTER);
  testOrgScopeFilterError(modelName, 'create', [ALL]);
  testOrgScopeFilter(modelName, 'view', [], TEST_USER_ORGS_FILTER);
  testOrgScopeFilterError(modelName, 'create', []);
  testOrgScopeFilter(modelName, 'view', [MANAGE_ALL_ORGANISATIONS], TEST_USER_ORGS_FILTER);
  it('view avec un jeton utilisateur', async () => {
    expect(await filterFor(modelName, 'view', createUserToken(TEST_OWNER_ID), createUser(TEST_OWNER_ID))).toEqual(TEST_USER_ORGS_FILTER);
  });
  testClientBasicScopeFilter(modelName, 'view', [ALL], TEST_USER_ORGS_FILTER);
  testClientBasicScopeFilter(modelName, 'view', [], TEST_USER_NO_ORGS_FILTER);
  testClientBasicScopeFilter(modelName, 'edit', [ALL], TEST_USER_ORGS_FILTER);
  testClientBasicScopeFilter(modelName, 'edit', [], TEST_USER_NO_ORGS_FILTER);
  testClientBasicScopeFilterError(modelName, 'create', [ALL]);
  testClientBasicScopeFilterError(modelName, 'create', []);
  testClientBasicScopeFilterError(modelName, 'delete', [ALL]);
  testClientBasicScopeFilterError(modelName, 'delete', []);
  for (const action of ACTIONS) testSiteAdminScopeFilter(modelName, action, {});
  it('edit : organisations des rôles « all » de l’utilisateur', async () => {
    const roleIds: unknown[][] = [];
    const withRoles = makeDeps({
      findRoleOrganisations: (ids) => { roleIds.push(ids); return Promise.resolve([{ organisation: TEST_ORG_ID }]); },
    });
    const roleId = new ObjectId();
    const user = { ...createUser(TEST_USER_ID), organisationSettings: [{ organisation: TEST_ORG_ID, roles: [roleId] }] };
    expect(await filterFor(modelName, 'edit', createOrgToken([]), user, undefined, withRoles)).toEqual(TEST_USER_ORGS_FILTER);
    expect(roleIds).toEqual([[roleId]]);
  });
  it('create : RESTRICT_CREATE_ORGANISATION=false ouvre la création aux administrateurs d’organisation', async () => {
    const open = makeDeps({ restrictCreateOrganisation: false });
    expect(await filterFor(modelName, 'create', createOrgToken([ALL]), createUser(TEST_USER_ID), undefined, open)).toBeUndefined();
  });
});

describe('statement-test', () => {
  const modelName = 'statement';
  const TEST_ORG_STATEMENT_FILTER = { ...TEST_ORG_FILTER, test: 1 };
  testOrgScopeFilter(modelName, 'view', [SITE_ADMIN], TEST_ORG_STATEMENT_FILTER);
  for (const scopes of [[SITE_ADMIN], [ALL], [], [MANAGE_ALL_USERS]]) {
    testOrgScopeFilter(modelName, 'view', scopes, TEST_ORG_STATEMENT_FILTER);
    for (const action of ['edit', 'create', 'delete']) testOrgScopeFilterError(modelName, action, scopes);
  }
  testOrgScopeFilterOwner(modelName, 'view', TEST_ORG_STATEMENT_FILTER);
  for (const action of ['edit', 'create', 'delete']) testOrgScopeFilterOwnerError(modelName, action);
  for (const action of ACTIONS) {
    testOwnerScopeFilterError(modelName, action);
    testSiteAdminScopeFilterError(modelName, action);
  }
  testClientBasicScopeFilter(modelName, 'view', [ALL], TEST_ORG_FILTER);
  testClientBasicScopeFilter(modelName, 'edit', [XAPI_ALL], TEST_ORG_FILTER);
  testClientBasicScopeFilter(modelName, 'edit', [XAPI_STATEMENTS_WRITE], TEST_ORG_FILTER);
  testClientBasicScopeFilter(modelName, 'delete', [XAPI_STATEMENTS_DELETE], TEST_ORG_FILTER);
  testClientBasicScopeFilterError(modelName, 'edit', []);
  testClientBasicScopeFilterError(modelName, 'edit', [ALL]);
  testClientBasicScopeFilterError(modelName, 'delete', []);
  testClientBasicScopeFilterError(modelName, 'delete', [ALL]);
  testClientBasicScopeFilterError(modelName, 'delete', [SITE_ADMIN]);
  it('client avec store et « read/mine » seul : filtre par store et par client', async () => {
    const lrsId = new ObjectId();
    const client = { ...createClient([XAPI_STATEMENTS_READ_MINE]), lrs_id: lrsId };
    expect(await filterFor(modelName, 'view', createClientToken([XAPI_STATEMENTS_READ_MINE]), undefined, client))
      .toEqual({ ...TEST_ORG_FILTER, lrs_id: lrsId, client: TEST_CLIENT_ID });
  });
  it('jeton de dashboard : refusé, sauf pour les agrégations', async () => {
    const token = { ...createDashToken([VIEW_SHAREABLE_DASHBOARD]), organisation: TEST_ORG_ID.toString() };
    await expect(filterFor(modelName, 'view', token)).rejects.toBeInstanceOf(NoAccessError);
    expect(await getScopeFilter(deps, { modelName, actionName: 'view', authInfo: { token }, allowDashboardAccess: true }))
      .toEqual({ ...TEST_ORG_FILTER, test: 1 });
  });
});

describe('user-test', () => {
  const modelName = 'user';
  const TEST_ORGS_FILTER = { organisations: TEST_ORG_ID };
  const TEST_USER_FILTER = { _id: TEST_USER_ID };
  const TEST_OWNER_ID_FILTER = { _id: TEST_OWNER_ID };
  testAllActions(modelName, [SITE_ADMIN], TEST_ORGS_FILTER);
  testAllActions(modelName, [ALL], TEST_ORGS_FILTER);
  testOrgScopeFilterOwner(modelName, 'view', TEST_ORGS_FILTER);
  testOrgScopeFilterOwner(modelName, 'edit', TEST_OWNER_ID_FILTER);
  testOrgScopeFilterOwnerError(modelName, 'create');
  testOrgScopeFilterOwnerError(modelName, 'delete');
  testOrgScopeFilter(modelName, 'view', [], TEST_ORGS_FILTER);
  testOrgScopeFilter(modelName, 'edit', [], TEST_USER_FILTER);
  testOrgScopeFilterError(modelName, 'create', []);
  testOrgScopeFilterError(modelName, 'delete', []);
  testOrgScopeFilter(modelName, 'view', [MANAGE_ALL_USERS], TEST_ORGS_FILTER);
  testOrgScopeFilter(modelName, 'edit', [MANAGE_ALL_USERS], TEST_ORGS_FILTER);
  testOrgScopeFilter(modelName, 'create', [MANAGE_ALL_USERS], TEST_ORGS_FILTER);
  testOrgScopeFilterError(modelName, 'delete', [MANAGE_ALL_USERS]);
  testOwnerScopeFilter(modelName, 'view', TEST_OWNER_ID_FILTER);
  testOwnerScopeFilter(modelName, 'edit', TEST_OWNER_ID_FILTER);
  testOwnerScopeFilterError(modelName, 'create');
  testOwnerScopeFilterError(modelName, 'delete');
  for (const action of ACTIONS) testSiteAdminScopeFilter(modelName, action, {});
});

describe('autres modèles', () => {
  it('querybuildercache et querybuildercachevalue : modèle global (scope all)', async () => {
    for (const modelName of ['querybuildercache', 'querybuildercachevalue']) {
      expect(await filterFor(modelName, 'view', createOrgToken([]), createUser(TEST_USER_ID))).toEqual(TEST_ORG_FILTER);
      await expect(filterFor(modelName, 'edit', createOrgToken([]), createUser(TEST_USER_ID))).rejects.toBeInstanceOf(NoAccessError);
    }
  });
  it('persona, personaidentifier, personaattribute, personasimport, importcsv : même filtre', async () => {
    for (const modelName of ['personaIdentifier', 'personaattribute', 'personasimport', 'importcsv']) {
      expect(await filterFor(modelName, 'view', createOrgToken([]), createUser(TEST_USER_ID))).toEqual(TEST_ORG_FILTER);
    }
  });
  it('batchdelete : scope statements/delete et ENABLE_STATEMENT_DELETION requis ; organisation brute', async () => {
    expect(await filterFor('batchdelete', 'view', createOrgToken([XAPI_STATEMENTS_DELETE]), createUser(TEST_USER_ID))).toEqual({ organisation: TEST_ORG_ID.toString() });
    await expect(filterFor('batchdelete', 'view', createOrgToken([ALL]), createUser(TEST_USER_ID))).rejects.toBeInstanceOf(NoAccessError);
    const disabled = makeDeps({ enableStatementDeletion: false });
    await expect(filterFor('batchdelete', 'view', createOrgToken([XAPI_STATEMENTS_DELETE]), undefined, undefined, disabled)).rejects.toBeInstanceOf(NoAccessError);
  });
  it('sitesettings : aucun filtre, quel que soit le jeton', async () => {
    expect(await filterFor('sitesettings', 'edit', createClientToken([]), undefined, createClient())).toEqual({});
  });
  it('modèle sans filtre (stream, personasimporttemplate) : erreur 500 « Invalid scope … requested »', async () => {
    await expect(filterFor('Stream', 'view', createOrgToken([]))).rejects.toThrow('Invalid scope stream requested');
    await expect(filterFor('PersonasImportTemplate', 'view', createOrgToken([]))).rejects.toThrow('Invalid scope personasimporttemplate requested');
  });
  it('organisation expirée : refus, sauf administrateur du site', async () => {
    const expired = makeDeps({ findOrganisation: () => Promise.resolve({ expiration: new Date('2000-01-01') }) });
    await expect(filterFor('lrs', 'view', createOrgToken([]), createUser(TEST_USER_ID), undefined, expired)).rejects.toBeInstanceOf(NoAccessError);
    expect(await filterFor('lrs', 'view', createOrgToken([SITE_ADMIN]), createUser(TEST_USER_ID), undefined, expired)).toEqual(TEST_ORG_FILTER);
  });
  it('identifiant d’organisation invalide : erreur bson', async () => {
    const token = { ...createOrgToken([]), tokenId: 'pas-un-id' };
    await expect(filterFor('lrs', 'view', token)).rejects.toThrow('Argument passed in must be a single String of 12 bytes or a string of 24 hex characters');
  });
});

describe('getScopeSelect', () => {
  it('seul User restreint les champs ; sélection étendue pour site_admin, all et user/manage', () => {
    expect(getScopeSelect({ modelName: 'lrs', authInfo: { token: createOrgToken([]) } })).toBeUndefined();
    expect(getScopeSelect({ modelName: 'User', authInfo: { token: createOrgToken([]) } })).toEqual(USER_SELECT);
    for (const scope of [SITE_ADMIN, ALL, MANAGE_ALL_USERS]) {
      expect(getScopeSelect({ modelName: 'user', authInfo: { token: createOrgToken([scope]) } })).toEqual(USER_MANAGER_SELECT);
    }
  });
});
