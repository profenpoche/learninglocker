// Scopes des clients, utilisateurs et rôles (portage de legacy/lib/constants/{scopes,orgScopes}.js,
// legacy/lib/helpers/scopes.js et des fonctions pures du formulaire des rôles).
export * from './constants.js';
export {
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
