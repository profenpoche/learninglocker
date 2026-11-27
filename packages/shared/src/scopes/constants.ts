// Scopes (droits) des clients, utilisateurs et rôles.
// Code d'origine : legacy/lib/constants/scopes.js et legacy/lib/constants/orgScopes.js.

export const ALL = 'all';

export const VIEW_SHAREABLE_DASHBOARD = 'dashboard/shareable/view';

// UDD
export const STUDENT_APP = 'student_app';
export const TRIBAL_INSIGHT = 'tribal_insight';
export const LAP = 'lap';
export const SSP = 'ssp';
export const OPENDASH = 'opendash';
export const UDD_READ = 'udd/read';

// xAPI
export const XAPI_ALL = 'xapi/all';
export const XAPI_READ = 'xapi/read';
export const XAPI_STATEMENTS_READ = 'statements/read';
export const XAPI_STATEMENTS_WRITE = 'statements/write';
export const XAPI_STATEMENTS_READ_MINE = 'statements/read/mine';
export const XAPI_STATE_ALL = 'state';
export const XAPI_PROFILE_ALL = 'profile';
export const XAPI_STATEMENTS_DELETE = 'statements/delete';

export const XAPI_SCOPES: Readonly<Record<string, string>> = {
  [XAPI_ALL]: 'All (xAPI)',
  [XAPI_READ]: 'Read all',
  [XAPI_STATEMENTS_READ]: 'Read all statements',
  [XAPI_STATEMENTS_WRITE]: 'Write statements (must be used with a read scope)',
  [XAPI_STATEMENTS_READ_MINE]: 'Read my statements',
  [XAPI_STATE_ALL]: 'Access state',
  [XAPI_PROFILE_ALL]: 'Access profiles',
};

/**
 * Scopes xAPI proposés pour un client. L'original retire XAPI_STATEMENTS_DELETE quand la suppression
 * est désactivée, mais ce scope n'est pas dans XAPI_SCOPES : le résultat est toujours le même contenu
 * (une copie dans ce cas). Côté serveur, l'original lit `process.env.ENABLE_STATEMENT_DELETION` (une
 * chaîne, donc « vraie » même si elle vaut 'false') : passer cette valeur brute.
 */
export const getXapiScopes = (deleteStatementsEnabled: unknown = true): Readonly<Record<string, string>> => {
  if (!deleteStatementsEnabled) {
    return Object.fromEntries(Object.entries(XAPI_SCOPES).filter(([key]) => key !== XAPI_STATEMENTS_DELETE));
  }
  return XAPI_SCOPES;
};

export const API_SCOPES: Readonly<Record<string, string>> = {
  [ALL]: 'API All',
  [XAPI_STATEMENTS_DELETE]: 'Delete statements (not covered by All scope)',
};

export const CLIENT_SCOPES: Readonly<Record<string, string>> = {
  ...API_SCOPES,
  ...XAPI_SCOPES,
};

// Utilisateurs
export const SITE_ADMIN = 'site_admin';
export const SITE_CAN_CREATE_ORG = 'site_can_create_org';

export const SITE_SCOPES: Readonly<Record<string, string>> = {
  [SITE_ADMIN]: 'Site Administrator',
  [SITE_CAN_CREATE_ORG]: 'Can create organisation',
};

// Utilisateur d'organisation
export const OBSERVER = 'observer';
export const USER_SCOPES: Readonly<Record<string, string>> = {
  [ALL]: 'Organisation Administrator',
  [OBSERVER]: 'Organisation Observer',
};

// --- orgScopes.js -----------------------------------------------------------------------------------

export const VIEW_PUBLIC_DASHBOARDS = 'org/public/dashboard/view';
export const EDIT_PUBLIC_DASHBOARDS = 'org/public/dashboard/edit';
export const VIEW_ALL_DASHBOARDS = 'org/all/dashboard/view';
export const EDIT_ALL_DASHBOARDS = 'org/all/dashboard/edit';

export const VIEW_PUBLIC_STATEMENTFORWARDING = 'org/public/statementForwarding/view';
export const EDIT_PUBLIC_STATEMENTFORWARDING = 'org/public/statementForwarding/edit';
export const VIEW_ALL_STATEMENTFORWARDING = 'org/all/statementForwarding/view';
export const EDIT_ALL_STATEMENTFORWARDING = 'org/all/statementForwarding/edit';

export const VIEW_PUBLIC_VISUALISATIONS = 'org/public/visualisation/view';
export const EDIT_PUBLIC_VISUALISATIONS = 'org/public/visualisation/edit';
export const VIEW_ALL_VISUALISATIONS = 'org/all/visualisation/view';
export const EDIT_ALL_VISUALISATIONS = 'org/all/visualisation/edit';

export const VIEW_PUBLIC_JOURNEYS = 'org/public/journey/view';
export const EDIT_PUBLIC_JOURNEYS = 'org/public/journey/edit';
export const VIEW_ALL_JOURNEYS = 'org/all/journey/view';
export const EDIT_ALL_JOURNEYS = 'org/all/journey/edit';

export const VIEW_PUBLIC_QUERIES = 'org/public/query/view';
export const EDIT_PUBLIC_QUERIES = 'org/public/query/edit';
export const VIEW_ALL_QUERIES = 'org/all/query/view';
export const EDIT_ALL_QUERIES = 'org/all/query/edit';

export const VIEW_PUBLIC_EXPORTS = 'org/public/export/view';
export const EDIT_PUBLIC_EXPORTS = 'org/public/export/edit';
export const VIEW_ALL_EXPORTS = 'org/all/export/view';
export const EDIT_ALL_EXPORTS = 'org/all/export/edit';

export const VIEW_PUBLIC_DOWNLOADS = 'org/public/download/view';
export const EDIT_PUBLIC_DOWNLOADS = 'org/public/download/edit';
export const VIEW_ALL_DOWNLOADS = 'org/all/download/view';
export const EDIT_ALL_DOWNLOADS = 'org/all/download/edit';

export const MANAGE_ALL_PERSONAS = 'org/all/persona/manage';
export const MANAGE_ALL_STORES = 'org/all/store/manage';
export const MANAGE_ALL_USERS = 'org/all/user/manage';
export const MANAGE_ALL_CLIENTS = 'org/all/client/manage';
export const MANAGE_ALL_ROLES = 'org/all/role/manage';
export const MANAGE_ALL_ORGANISATIONS = 'org/all/organisation/manage';

/** Libellé de chaque groupe de scopes (ligne du tableau des rôles). */
export const roleGroupNames: Readonly<Record<string, string>> = {
  'org/public/dashboard': 'Dashboards (public only)',
  'org/all/dashboard': 'Dashboards (all)',

  'org/public/statementForwarding': 'Statement Forwards (public only)',
  'org/all/statementForwarding': 'Statement Forwards (all)',

  'org/public/visualisation': 'Visualisations (public only)',
  'org/all/visualisation': 'Visualisations (all)',

  'org/public/journey': 'Journeys (public only)',
  'org/all/journey': 'Journeys (all)',

  'org/public/query': 'Saved Queries (public only)',
  'org/all/query': 'Saved Queries (all)',

  'org/public/export': 'Saved Exports (public only)',
  'org/all/export': 'Saved Exports (all)',

  'org/public/download': 'Export Downloads (public only)',
  'org/all/download': 'Export Downloads (all)',

  'org/all/persona': 'Personas',
  'org/all/store': 'Stores',
  'org/all/user': 'Users',
  'org/all/client': 'Clients',
  'org/all/role': 'Roles',
  'org/all/organisation': 'Organisations',
};

/** Scopes proposés pour un rôle, dans l'ordre d'origine (MANAGE_ALL_ORGANISATIONS est commenté à l'origine). */
export const orgScopes: readonly string[] = [
  ALL,
  VIEW_PUBLIC_DASHBOARDS,
  EDIT_PUBLIC_DASHBOARDS,
  VIEW_ALL_DASHBOARDS,
  EDIT_ALL_DASHBOARDS,
  VIEW_PUBLIC_VISUALISATIONS,
  EDIT_PUBLIC_VISUALISATIONS,
  VIEW_ALL_VISUALISATIONS,
  EDIT_ALL_VISUALISATIONS,
  VIEW_PUBLIC_JOURNEYS,
  EDIT_PUBLIC_JOURNEYS,
  VIEW_ALL_JOURNEYS,
  EDIT_ALL_JOURNEYS,

  VIEW_PUBLIC_STATEMENTFORWARDING,
  EDIT_PUBLIC_STATEMENTFORWARDING,
  VIEW_ALL_STATEMENTFORWARDING,
  EDIT_ALL_STATEMENTFORWARDING,

  VIEW_ALL_QUERIES,
  EDIT_ALL_QUERIES,
  VIEW_ALL_EXPORTS,
  EDIT_ALL_EXPORTS,
  VIEW_ALL_DOWNLOADS,
  EDIT_ALL_DOWNLOADS,

  MANAGE_ALL_PERSONAS,
  MANAGE_ALL_STORES,
  MANAGE_ALL_USERS,
  MANAGE_ALL_CLIENTS,
  MANAGE_ALL_ROLES,
];
