// Filtres de droits par modèle (« scope filters ») : requête MongoDB qui restreint ce qu'un jeton
// peut lire ou modifier, ou erreur NoAccessError (403).
// Codes d'origine : legacy/lib/services/auth/filters/{getScopeFilter,getOrgFilter,getPrivateOrgFilter,
// getPublicOrgFilter,getShareableModelFilter,getAdminModelFilter,getGlobalModelFilter}.js,
// legacy/lib/services/auth/filters/utils/getModelsFilter.js, legacy/lib/services/auth/modelFilters/*.js,
// legacy/lib/services/auth/selects/{getScopeSelect,models/user}.js.
//
// Les accès à la base sont injectés (ScopeDeps) : les tests portés du legacy tournent sans MongoDB.
// Sémantique reproduite : `mongoose.Types.ObjectId(x)` de bson 1.1 (nouvel ObjectId aléatoire pour
// null/undefined, erreur pour une chaîne invalide), chaîne de filtres arrêtée au premier résultat
// « vrai » (un objet, même vide), messages d'erreur identiques.
import {
  ALL, EDIT_ALL_DASHBOARDS, EDIT_ALL_DOWNLOADS, EDIT_ALL_EXPORTS, EDIT_ALL_QUERIES, EDIT_ALL_STATEMENTFORWARDING,
  EDIT_ALL_VISUALISATIONS, EDIT_PUBLIC_DASHBOARDS, EDIT_PUBLIC_DOWNLOADS, EDIT_PUBLIC_EXPORTS, EDIT_PUBLIC_QUERIES,
  EDIT_PUBLIC_STATEMENTFORWARDING, EDIT_PUBLIC_VISUALISATIONS, MANAGE_ALL_CLIENTS, MANAGE_ALL_ORGANISATIONS,
  MANAGE_ALL_PERSONAS, MANAGE_ALL_ROLES, MANAGE_ALL_STORES, MANAGE_ALL_USERS, SITE_ADMIN, SITE_CAN_CREATE_ORG,
  VIEW_ALL_DASHBOARDS, VIEW_ALL_DOWNLOADS, VIEW_ALL_EXPORTS, VIEW_ALL_QUERIES, VIEW_ALL_STATEMENTFORWARDING,
  VIEW_ALL_VISUALISATIONS, VIEW_PUBLIC_DASHBOARDS, VIEW_PUBLIC_DOWNLOADS, VIEW_PUBLIC_EXPORTS, VIEW_PUBLIC_QUERIES,
  VIEW_PUBLIC_STATEMENTFORWARDING, VIEW_PUBLIC_VISUALISATIONS, VIEW_SHAREABLE_DASHBOARD, XAPI_ALL, XAPI_READ,
  XAPI_STATEMENTS_DELETE, XAPI_STATEMENTS_READ, XAPI_STATEMENTS_READ_MINE, XAPI_STATEMENTS_WRITE,
} from '@ll/shared';
import {
  getDashboardFromAuthInfo, getFilterFromAuthInfo, getOrgFromAuthInfo, getScopesFromAuthInfo, getTokenTypeFromAuthInfo,
  getUserIdFromAuthInfo, type AuthInfo,
} from '../auth/auth-info.js';
import { NoAccessError } from '../http/request-errors.js';

export type ActionName = 'view' | 'create' | 'edit' | 'delete';
export type Filter = Record<string, unknown>;

export interface ScopeFilterOptions {
  modelName: string;
  actionName: string;
  authInfo: AuthInfo;
  allowDashboardAccess?: boolean;
}

export interface ScopeDeps {
  /** `mongoose.Types.ObjectId(x)` du legacy (bson 1.1). */
  objectId(value: unknown): unknown;
  /** Organisation.findById : seule la date d'expiration est lue. */
  findOrganisation(id: unknown): Promise<{ expiration?: unknown } | null>;
  /** Role.find({ _id: { $in: roleIds }, scopes: { $in: scopes } }).select({ organisation: 1 }).lean() */
  findRoleOrganisations(roleIds: unknown[], scopes: string[]): Promise<{ organisation?: unknown }[]>;
  /** Identifiants des visualisations des widgets d'un dashboard (agrégation $unwind du legacy). */
  dashboardVisualisationIds(dashboardId: unknown): Promise<unknown[]>;
  /** parseQuery (lib/helpers/parseQuery), pour le filtre de statements porté par le jeton. */
  parseQuery(filter: unknown, authInfo: AuthInfo): Promise<unknown>;
  enableStatementDeletion: boolean;
  restrictCreateOrganisation: boolean;
  now?: () => Date;
}

const includes = (list: unknown, value: unknown): boolean => Array.isArray(list) && list.includes(value);
const some = (required: readonly string[], scopes: unknown[]): boolean => required.some((s) => scopes.includes(s));

// --- filtres communs -------------------------------------------------------------------------------

/** getOrgFilter : `{ organisation: ObjectId(org) }`, ou `{}` pour un administrateur du site sans organisation. */
export const getOrgFilter = (deps: ScopeDeps, authInfo: AuthInfo): Filter => {
  const scopes = getScopesFromAuthInfo(authInfo);
  const orgId = getOrgFromAuthInfo(authInfo);
  if (includes(scopes, SITE_ADMIN) && !orgId) return {};
  return { organisation: deps.objectId(orgId) };
};

/** getPrivateOrgFilter : documents de l'utilisateur dans l'organisation ; false sans utilisateur (client). */
const getPrivateOrgFilter = (deps: ScopeDeps, authInfo: AuthInfo): Filter | false => {
  const orgFilter = getOrgFilter(deps, authInfo);
  const userId = getUserIdFromAuthInfo(authInfo);
  if (userId === undefined) return false;
  return { $and: [{ owner: deps.objectId(userId) }, orgFilter] };
};

const getPublicOrgFilter = (deps: ScopeDeps, authInfo: AuthInfo): Filter => {
  const orgFilter = getOrgFilter(deps, authInfo);
  const privateFilter = getPrivateOrgFilter(deps, authInfo);
  return { $or: [{ $and: [{ isPublic: true }, orgFilter] }, ...(privateFilter ? [privateFilter] : [])] };
};

interface ScopeConstants {
  viewAllScopes?: string[];
  editAllScopes?: string[];
  viewPublicScopes?: string[];
  editPublicScopes?: string[];
  allowedTokenTypes?: string[];
}

type ChainFilter = (deps: ScopeDeps, constants: ScopeConstants, options: ScopeFilterOptions) => Filter | undefined | false | Promise<Filter | undefined | false>;

const checkOrganisationExpirery: ChainFilter = async (deps, _constants, { authInfo }) => {
  const { organisation } = getOrgFilter(deps, authInfo);
  const org = await deps.findOrganisation(organisation);
  if (getScopesFromAuthInfo(authInfo).some((item) => item === SITE_ADMIN)) return undefined;
  const expiration = org?.expiration;
  if (org && expiration && new Date(expiration as string).getTime() < (deps.now ?? (() => new Date()))().getTime()) {
    throw new NoAccessError();
  }
  return undefined;
};

const getSiteAdminFilter: ChainFilter = (deps, _constants, { authInfo }) =>
  (includes(getScopesFromAuthInfo(authInfo), SITE_ADMIN) ? getOrgFilter(deps, authInfo) : undefined);

const checkAllowedTokenType: ChainFilter = (_deps, { allowedTokenTypes = ['organisation', 'client'] }, { authInfo }) => {
  if (!allowedTokenTypes.includes(getTokenTypeFromAuthInfo(authInfo) as string)) throw new NoAccessError();
  return undefined;
};

const checkAllScope: ChainFilter = (deps, _constants, { authInfo }) =>
  (includes(getScopesFromAuthInfo(authInfo), ALL) ? getOrgFilter(deps, authInfo) : undefined);

/** getModelsFilter : vérification d'expiration, puis premier filtre qui renvoie une valeur. */
const modelsFilter = (constants: ScopeConstants, filters: ChainFilter[]) =>
  async (deps: ScopeDeps, options: ScopeFilterOptions): Promise<Filter | undefined | false> => {
    let result: Filter | undefined | false;
    for (const filter of [checkOrganisationExpirery, ...filters]) {
      if (result) return result;
      result = await filter(deps, constants, options);
    }
    return result;
  };

const shareableModelFilter: ChainFilter = (deps, { viewAllScopes = [], viewPublicScopes = [], editAllScopes = [], editPublicScopes = [] }, { actionName, authInfo }) => {
  const scopes = getScopesFromAuthInfo(authInfo);
  if (actionName === 'view') {
    if (some([...viewAllScopes, ...editAllScopes], scopes)) return getOrgFilter(deps, authInfo);
    if (some([...viewPublicScopes, ...editPublicScopes], scopes)) return getPublicOrgFilter(deps, authInfo);
  } else {
    if (some(editAllScopes, scopes)) return getOrgFilter(deps, authInfo);
    if (some(editPublicScopes, scopes)) return getPublicOrgFilter(deps, authInfo);
  }
  const privateFilter = getPrivateOrgFilter(deps, authInfo);
  if (!privateFilter) throw new NoAccessError();
  return privateFilter;
};

const adminModelFilter: ChainFilter = (deps, { viewAllScopes = [], editAllScopes = [] }, { actionName, authInfo }) => {
  const scopes = getScopesFromAuthInfo(authInfo);
  const allowed = actionName === 'view' ? [...viewAllScopes, ...editAllScopes] : editAllScopes;
  if (some(allowed, scopes)) return getOrgFilter(deps, authInfo);
  throw new NoAccessError();
};

const globalModelFilter: ChainFilter = (deps, { editAllScopes = [] }, { actionName, authInfo }) => {
  const scopes = getScopesFromAuthInfo(authInfo);
  // authInfo.token.tokenType : TypeError sans jeton, comme le legacy.
  const tokenType = (authInfo.token as { tokenType?: unknown }).tokenType;
  if (actionName === 'view' && tokenType === 'organisation') return getOrgFilter(deps, authInfo);
  if (some(editAllScopes, scopes)) return getOrgFilter(deps, authInfo);
  throw new NoAccessError();
};

const shareable = (constants: ScopeConstants) =>
  modelsFilter(constants, [getSiteAdminFilter, checkAllowedTokenType, checkAllScope, shareableModelFilter]);
const admin = (constants: ScopeConstants) =>
  modelsFilter(constants, [getSiteAdminFilter, checkAllowedTokenType, checkAllScope, adminModelFilter]);
const global = (constants: ScopeConstants) =>
  modelsFilter(constants, [getSiteAdminFilter, checkAllowedTokenType, checkAllScope, globalModelFilter]);

// --- filtres propres à un modèle -------------------------------------------------------------------

const dashboardTokenFilter: ChainFilter = (deps, _constants, { actionName, authInfo }) => {
  if (getTokenTypeFromAuthInfo(authInfo) !== 'dashboard') return undefined;
  if (actionName !== 'view' || !includes(getScopesFromAuthInfo(authInfo), VIEW_SHAREABLE_DASHBOARD)) throw new NoAccessError();
  return { _id: deps.objectId(getDashboardFromAuthInfo(authInfo)) };
};

const visualisationDashboardFilter: ChainFilter = async (deps, _constants, { actionName, authInfo }) => {
  if (getTokenTypeFromAuthInfo(authInfo) !== 'dashboard') return undefined;
  if (actionName !== 'view' || !includes(getScopesFromAuthInfo(authInfo), VIEW_SHAREABLE_DASHBOARD)) throw new NoAccessError();
  const ids = await deps.dashboardVisualisationIds(deps.objectId(getDashboardFromAuthInfo(authInfo)));
  return { _id: { $in: ids.map((id) => deps.objectId(id)) } };
};

const DASHBOARD_TOKEN_TYPES = ['organisation', 'dashboard', 'client'];

const dashboardFilter = modelsFilter({
  viewAllScopes: [VIEW_ALL_DASHBOARDS], editAllScopes: [EDIT_ALL_DASHBOARDS],
  viewPublicScopes: [VIEW_PUBLIC_DASHBOARDS], editPublicScopes: [EDIT_PUBLIC_DASHBOARDS],
  allowedTokenTypes: DASHBOARD_TOKEN_TYPES,
}, [getSiteAdminFilter, checkAllowedTokenType, dashboardTokenFilter, checkAllScope, shareableModelFilter]);

const visualisationFilter = modelsFilter({
  viewAllScopes: [VIEW_ALL_VISUALISATIONS], editAllScopes: [EDIT_ALL_VISUALISATIONS],
  viewPublicScopes: [VIEW_PUBLIC_VISUALISATIONS], editPublicScopes: [EDIT_PUBLIC_VISUALISATIONS],
  allowedTokenTypes: DASHBOARD_TOKEN_TYPES,
}, [getSiteAdminFilter, checkAllowedTokenType, visualisationDashboardFilter, checkAllScope, shareableModelFilter]);

const MODEL_FILTERS: Record<string, (deps: ScopeDeps, options: ScopeFilterOptions) => Promise<Filter | undefined | false>> = {
  client: admin({ viewAllScopes: [MANAGE_ALL_CLIENTS], editAllScopes: [MANAGE_ALL_CLIENTS] }),
  role: admin({ viewAllScopes: [MANAGE_ALL_ROLES, MANAGE_ALL_USERS], editAllScopes: [MANAGE_ALL_ROLES] }),
  lrs: global({ editAllScopes: [MANAGE_ALL_STORES] }),
  persona: global({ editAllScopes: [MANAGE_ALL_PERSONAS] }),
  querybuildercache: global({ editAllScopes: [ALL] }),
  dashboard: dashboardFilter,
  visualisation: visualisationFilter,
  download: shareable({ viewAllScopes: [VIEW_ALL_DOWNLOADS], editAllScopes: [EDIT_ALL_DOWNLOADS], viewPublicScopes: [VIEW_PUBLIC_DOWNLOADS], editPublicScopes: [EDIT_PUBLIC_DOWNLOADS] }),
  export: shareable({ viewAllScopes: [VIEW_ALL_EXPORTS], editAllScopes: [EDIT_ALL_EXPORTS], viewPublicScopes: [VIEW_PUBLIC_EXPORTS], editPublicScopes: [EDIT_PUBLIC_EXPORTS] }),
  query: shareable({ viewAllScopes: [VIEW_ALL_QUERIES], editAllScopes: [EDIT_ALL_QUERIES], viewPublicScopes: [VIEW_PUBLIC_QUERIES], editPublicScopes: [EDIT_PUBLIC_QUERIES] }),
  statementforwarding: shareable({
    viewAllScopes: [VIEW_ALL_STATEMENTFORWARDING], editAllScopes: [EDIT_ALL_STATEMENTFORWARDING],
    viewPublicScopes: [VIEW_PUBLIC_STATEMENTFORWARDING], editPublicScopes: [EDIT_PUBLIC_STATEMENTFORWARDING],
  }),
};

// modelFilters/organisation.js
const organisationFilter = async (deps: ScopeDeps, { actionName, authInfo }: ScopeFilterOptions): Promise<Filter | undefined> => {
  const scopes = getScopesFromAuthInfo(authInfo);
  if (scopes.includes(SITE_ADMIN)) return {};
  const tokenType = getTokenTypeFromAuthInfo(authInfo);
  const editable = async (): Promise<unknown[]> => {
    if (tokenType === 'client') return scopes.includes(ALL) ? [getOrgFromAuthInfo(authInfo)] : [];
    if (tokenType !== 'organisation') return [];
    const settings = (authInfo.user?.organisationSettings as { roles?: unknown }[] | undefined) ?? [];
    const roleIds = settings.flatMap(({ roles }) => (Array.isArray(roles) ? roles as unknown[] : [roles]));
    const roles = await deps.findRoleOrganisations(roleIds, [ALL]);
    return roles.map(({ organisation }) => organisation);
  };
  switch (actionName) {
    case 'view': {
      let ids: unknown[] = [];
      if (tokenType === 'client') {
        if (scopes.includes(ALL)) ids.push(getOrgFromAuthInfo(authInfo));
      } else if (tokenType === 'organisation' || tokenType === 'user') {
        const organisations = authInfo.user?.organisations;
        ids = organisations === undefined ? [] : organisations as unknown[];
      }
      return { _id: { $in: ids } };
    }
    case 'create':
      if (deps.restrictCreateOrganisation && !scopes.includes(SITE_CAN_CREATE_ORG)) throw new NoAccessError();
      if (tokenType !== 'organisation' || ![ALL, MANAGE_ALL_ORGANISATIONS].some((s) => scopes.includes(s))) throw new NoAccessError();
      return undefined;
    case 'delete':
      if (tokenType !== 'organisation') throw new NoAccessError();
      return { _id: { $in: await editable() } };
    case 'edit':
      return { _id: { $in: await editable() } };
    default:
      throw new NoAccessError();
  }
};

// modelFilters/statement.js
const READ_ALL_SCOPES = [ALL, XAPI_ALL, XAPI_READ, XAPI_STATEMENTS_READ];
const statementFilter = async (deps: ScopeDeps, { actionName, authInfo, allowDashboardAccess = false }: ScopeFilterOptions): Promise<Filter> => {
  const tokenType = getTokenTypeFromAuthInfo(authInfo);
  const tokenScopes = getScopesFromAuthInfo(authInfo);
  const hasWrite = includes(tokenScopes, XAPI_ALL) || includes(tokenScopes, XAPI_STATEMENTS_WRITE);
  if ((actionName === 'create' || actionName === 'edit') && !hasWrite) throw new NoAccessError();
  if (actionName === 'delete' && !includes(tokenScopes, XAPI_STATEMENTS_DELETE)) throw new NoAccessError();

  const parsedFilter = await deps.parseQuery(getFilterFromAuthInfo(authInfo), authInfo);
  // `{ ...parsedFilter, ...orgFilter }` : parseQuery peut renvoyer une erreur (étalée comme un objet).
  const filter: Filter = { ...(parsedFilter as Filter), ...getOrgFilter(deps, authInfo) };
  switch (tokenType) {
    case 'user':
      throw new NoAccessError();
    case 'dashboard':
      if (!allowDashboardAccess) throw new NoAccessError();
      return filter;
    case 'client': {
      const client = authInfo.client as { lrs_id?: unknown; _id?: unknown } | undefined;
      const lrsId: unknown = client?.lrs_id ?? false;
      const withLrs = lrsId ? { ...filter, lrs_id: deps.objectId(lrsId) } : filter;
      if (actionName === 'delete') return withLrs;
      const hasReadAll = tokenScopes.some((scope) => READ_ALL_SCOPES.includes(scope as string));
      if (!hasReadAll && tokenScopes.includes(XAPI_STATEMENTS_READ_MINE)) {
        return { ...withLrs, client: deps.objectId(client?._id ?? false) };
      }
      return withLrs;
    }
    default:
      return filter;
  }
};

// modelFilters/user.js
const userFilter = (deps: ScopeDeps, { actionName, authInfo }: ScopeFilterOptions): Filter => {
  const scopes = getScopesFromAuthInfo(authInfo);
  const orgsFilter = (): Filter => {
    const orgId = getOrgFromAuthInfo(authInfo);
    if (scopes.includes(SITE_ADMIN) && !orgId) return {};
    return { organisations: deps.objectId(orgId) };
  };
  const selfFilter = (): Filter => ({ _id: deps.objectId(getUserIdFromAuthInfo(authInfo)) });
  if (scopes.includes(SITE_ADMIN) || scopes.includes(ALL)) return orgsFilter();
  switch (actionName) {
    case 'view': {
      const tokenType = (authInfo.token as { tokenType?: unknown }).tokenType;
      if (tokenType === 'user') return selfFilter();
      if (tokenType === 'organisation') return orgsFilter();
      throw new NoAccessError();
    }
    case 'create':
      if (scopes.includes(MANAGE_ALL_USERS)) return orgsFilter();
      throw new NoAccessError();
    case 'edit':
      return scopes.includes(MANAGE_ALL_USERS) ? orgsFilter() : selfFilter();
    default:
      throw new NoAccessError();
  }
};

// modelFilters/batchDelete.js
const batchDeleteFilter = (deps: ScopeDeps, { authInfo }: ScopeFilterOptions): Filter => {
  if (!deps.enableStatementDeletion) throw new NoAccessError();
  if (!includes(getScopesFromAuthInfo(authInfo), XAPI_STATEMENTS_DELETE)) throw new NoAccessError();
  return { organisation: getOrgFromAuthInfo(authInfo) };
};

/** getScopeFilter : filtre du modèle (nom insensible à la casse) ; modèle inconnu → Error (500). */
export const getScopeFilter = async (deps: ScopeDeps, options: ScopeFilterOptions): Promise<unknown> => {
  const name = options.modelName.toLowerCase();
  switch (name) {
    case 'organisation': return organisationFilter(deps, options);
    case 'personaidentifier':
    case 'personaattribute':
    case 'personasimport':
    case 'importcsv': return MODEL_FILTERS.persona?.(deps, options);
    case 'querybuildercachevalue': return MODEL_FILTERS.querybuildercache?.(deps, options);
    case 'statement': return statementFilter(deps, options);
    case 'user': return userFilter(deps, options);
    case 'batchdelete': return batchDeleteFilter(deps, options);
    case 'sitesettings': return {};
    default: {
      const filter = Object.hasOwn(MODEL_FILTERS, name) ? MODEL_FILTERS[name] : undefined;
      if (!filter) throw new Error(`Invalid scope ${name} requested`);
      return filter(deps, options);
    }
  }
};

// --- sélection de champs (selects) -----------------------------------------------------------------

export const USER_SELECT = { _id: 1, email: 1, name: 1, organisations: 1 } as const;
export const USER_MANAGER_SELECT = {
  _id: 1, name: 1, email: 1, ownerOrganisation: 1, organisations: 1, organisationSettings: 1,
  ownerOrganisationSettings: 1, scopes: 1, createdAt: 1, updatedAt: 1, verified: 1,
} as const;

/** getScopeSelect : seul le modèle User restreint les champs lus. */
export const getScopeSelect = ({ modelName, authInfo }: { modelName: string; authInfo: AuthInfo }): Record<string, 1> | undefined => {
  if (modelName.toLowerCase() !== 'user') return undefined;
  const scopes = getScopesFromAuthInfo(authInfo);
  return [SITE_ADMIN, ALL, MANAGE_ALL_USERS].some((s) => scopes.includes(s)) ? { ...USER_MANAGER_SELECT } : { ...USER_SELECT };
};
