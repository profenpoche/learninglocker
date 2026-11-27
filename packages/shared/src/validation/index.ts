// Validation : mots de passe et identifiants (IFI) de persona.
export {
  DEFAULT_PASSWORD_SETTINGS,
  nextPasswordHistory,
  sortByDate,
  validatePassword,
  validatePasswordUtil,
  type PasswordCheck,
  type PasswordHistoryItem,
  type PasswordSettings,
  type ValidatePasswordArgs,
} from './password.js';
export {
  RulrRequiredWarning,
  RulrRestrictedKeysWarning,
  RulrTypeWarning,
  RulrWarning,
  RulrWarnings,
  XapiTypeWarning,
  assertValidIfi,
  assertValidIfis,
  hasIdentifierValueErrors,
  messageFromWarning,
  validateIfi,
  validateIri,
  validateMailto,
  validateSha1,
} from './ifi.js';
