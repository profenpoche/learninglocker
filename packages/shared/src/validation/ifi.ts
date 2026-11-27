// Validation des identifiants (IFI) de persona et messages d'erreur renvoyés par l'API.
// Code d'origine :
//   - legacy/lib/services/persona/validateIfi.js (serveur : routes personaidentifier, import de personas) ;
//   - rulr 4.0.2 (dist/index.js : Warning, règles checkType, checkRegex, required, restrictToSchema,
//     restrictToCollection, maybe) ;
//   - @learninglocker/xapi-validation 2.1.10 (dist/regexValues/{mailto,iri,sha1}.js, warnings/TypeWarning.js) ;
//   - legacy/api/src/controllers/utils/constructMessageFromRulrWarning.js (message de l'API) ;
//   - legacy/ui/src/pages/PeopleManagePage/IdentifiersEditor/hasIdentifierValueErrors.js (formulaire).

type Path = readonly string[];

/** rulr Warning. `name` reprend le nom de la classe d'origine (les deux TypeWarning s'appellent ainsi). */
export class RulrWarning {
  readonly message: string = 'Validation Error';
  readonly name: string = 'Warning';
  constructor(readonly data: unknown, readonly path: Path) {}
}

/** rulr TypeWarning : `type` est le constructeur attendu (String, Object, Array). */
export class RulrTypeWarning extends RulrWarning {
  override readonly name = 'TypeWarning';
  constructor(data: unknown, path: Path, readonly type: StringConstructor | ObjectConstructor | ArrayConstructor) { super(data, path); }
}

export class RulrRequiredWarning extends RulrWarning {
  override readonly name = 'RequiredWarning';
}

export class RulrRestrictedKeysWarning extends RulrWarning {
  override readonly name = 'RestrictedKeysWarning';
  constructor(data: unknown, path: Path, readonly keys: string[]) { super(data, path); }
}

/** Levée par maybe() : liste des avertissements. */
export class RulrWarnings extends RulrWarning {
  override readonly name = 'Warnings';
  constructor(data: unknown, path: Path, readonly warnings: readonly unknown[]) { super(data, path); }
}

/** TypeWarning de xapi-validation (classe distincte de celle de rulr, même nom). */
export class XapiTypeWarning extends RulrWarning {
  override readonly name = 'TypeWarning';
  constructor(data: unknown, path: Path, readonly typeName: string) { super(data, path); }
}

type Rule = (data: unknown, path: Path) => unknown[];

const first = (preReq: Rule, postReq: Rule): Rule => (data, path) => {
  const warnings = preReq(data, path);
  return warnings.length > 0 ? warnings : postReq(data, path);
};

const checkType = (type: StringConstructor | ObjectConstructor | ArrayConstructor): Rule => (data, path) =>
  data === undefined || data === null || (data as { constructor?: unknown }).constructor !== type ? [new RulrTypeWarning(data, path, type)] : [];

const checkRegex = (regex: RegExp, typeName: string): Rule =>
  first(checkType(String), (data, path) => (regex.test(data as string) ? [] : [new XapiTypeWarning(data, path, typeName)]));

const required = (rule: Rule): Rule => (data, path) => (data === undefined ? [new RulrRequiredWarning(data, path)] : rule(data, path));

const restrictToSchema = (schema: Readonly<Record<string, Rule>>): Rule => {
  const hasSchema: Rule = (data, path) => Object.keys(schema).flatMap((key) => (schema[key] as Rule)((data as Record<string, unknown>)[key], [...path, key]));
  const restrictToKeys: Rule = (data, path) => {
    const invalidKeys = Object.keys(data as object).filter((key) => !Object.keys(schema).includes(key));
    return invalidKeys.length === 0 ? [] : [new RulrRestrictedKeysWarning(data, path, invalidKeys)];
  };
  return first(checkType(Object), (data, path) => [...hasSchema(data, path), ...first(checkType(Object), restrictToKeys)(data, path)]);
};

/** Adresse mailto (xapi-validation). */
export const validateMailto: Rule = checkRegex(/^mailto:[A-Z0-9.`'_%+-]+@[A-Z0-9.-]+\.[A-Z]{1,63}$/i, 'Mailto');
/** IRI : seulement « schéma: » au début (xapi-validation). */
export const validateIri: Rule = checkRegex(/^\w+:/i, 'Internationalized Resource Identifier (IRI)');
/** SHA-1 : 5 à 40 chiffres hexadécimaux (xapi-validation). */
export const validateSha1: Rule = checkRegex(/^\b[0-9a-f]{5,40}$/i, 'Sha1');

/**
 * Avertissements de validation d'un IFI `{ key, value }` (tableau vide si valide). Une clé inconnue
 * donne `['invalid key']` (une chaîne, pas un Warning : comportement d'origine).
 */
export const validateIfi = (ifi: { key?: unknown; value?: unknown }, path: Path): unknown[] => {
  const valuePath = [...path, 'value'];
  if (ifi.key === 'mbox') return validateMailto(ifi.value, valuePath);
  if (ifi.key === 'mbox_sha1sum') return validateSha1(ifi.value, valuePath);
  if (ifi.key === 'openid') return validateIri(ifi.value, valuePath);
  if (ifi.key === 'account') {
    return restrictToSchema({ homePage: required(validateIri), name: required(checkType(String)) })(ifi.value, valuePath);
  }
  return ['invalid key'];
};

// rulr maybe() : lève RulrWarnings s'il y a des avertissements, sinon renvoie la donnée.
const maybe = <T>(rule: (data: T, path: Path) => unknown[]) => (data: T, path: Path): T => {
  const warnings = rule(data, path);
  // rulr lève un objet Warnings qui n'hérite pas d'Error : reproduit (les appelants testent instanceof).
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  if (warnings.length > 0) throw new RulrWarnings(data, path, warnings);
  return data;
};

/** Valide un IFI et lève RulrWarnings en cas d'erreur (export par défaut d'origine). */
export const assertValidIfi = maybe(validateIfi);

/** Valide une liste d'IFI (import de personas) et lève RulrWarnings en cas d'erreur. */
export const assertValidIfis = maybe((data: unknown, path: Path): unknown[] =>
  first(checkType(Array), (list, listPath) => (list as unknown[]).flatMap((ifi, index) => validateIfi(ifi as { key?: unknown }, [...listPath, index.toString()])))(data, path));

/** Message d'erreur de l'API pour un avertissement (constructMessageFromRulrWarning). */
export const messageFromWarning = (warning: unknown): unknown => {
  if (warning instanceof RulrWarning) {
    const path = warning.path.join('.');
    if (warning instanceof XapiTypeWarning) return `Invalid ${warning.typeName} in ${path}`;
    if (warning instanceof RulrTypeWarning) return `Invalid ${warning.type.name} in ${path}`;
    if (warning instanceof RulrRequiredWarning) return `Missing required data in ${path}`;
    if (warning instanceof RulrRestrictedKeysWarning) return `Invalid keys (${warning.keys.join(', ')}) in ${path}`;
    return `${warning.message} in ${path}`;
  }
  return warning;
};

/**
 * Formulaire des identifiants (front) : vrai si la valeur saisie est invalide pour ce type.
 * Pour « account », `value` est l'objet `{ homePage, name }` (Map à l'origine).
 */
export const hasIdentifierValueErrors = (identifierType: unknown, identifierValue: unknown): boolean => {
  switch (identifierType) {
    case 'account': {
      if (identifierValue === null || typeof identifierValue !== 'object' || Array.isArray(identifierValue)) {
        throw new TypeError('identifierValue.get is not a function');
      }
      const account = identifierValue as Record<string, unknown>;
      const homePage = Object.hasOwn(account, 'homePage') ? account.homePage : undefined;
      const name = Object.hasOwn(account, 'name') ? account.name : undefined;
      const hasHomePageErrors = validateIri(homePage, ['homePage']).length !== 0;
      const hasNameErrors = (name as { length: number }).length === 0;
      return hasHomePageErrors || hasNameErrors;
    }
    case 'mbox':
      return validateMailto(identifierValue, ['mbox']).length !== 0;
    case 'mbox_sha1sum':
      return (identifierValue as { length: number }).length === 0;
    case 'openid':
      return validateIri(identifierValue, ['openid']).length !== 0;
    default:
      return true;
  }
};
