// Dépendances entre scopes, calcul des scopes d'un rôle (formulaire des rôles) et vérifications simples.
// Code d'origine : legacy/lib/helpers/scopes.js, legacy/ui/src/pages/SettingsRolesPage/RoleForm.js
// (generateNewScopes, groupScopes, getLabel, getRowLabel), legacy/api/src/auth/jwt.js
// (createOrgTokenPayload : scopes d'un jeton d'organisation), legacy/lib/services/auth/canViewModel.js,
// legacy/lib/services/auth/canCreateOrganisations.js.

import { ImmutableStringSet } from '../immutable-set.js';
import { assignValue, toConsumableArray } from '../query/lodash.js';
import { ALL, SITE_ADMIN, SITE_CAN_CREATE_ORG, orgScopes, roleGroupNames } from './constants.js';

// --- Dépendances --------------------------------------------------------------------------------

// « …/edit » dépend de « …/view » s'il existe dans la liste.
const getWriteDependencies = (scope: string, scopes: readonly unknown[]): string[] => {
  const arrayKey = scope.split('/');
  const rest = arrayKey.slice(0, -1);
  const depScope = [...rest, 'view'].join('/');
  return arrayKey.at(-1) === 'edit' && scopes.includes(depScope) ? [depScope] : [];
};

// « all » dépend de tous les autres scopes de la liste.
const getAllAllDependencies = (scope: string, scopes: readonly unknown[]): unknown[] => (scope === ALL ? scopes.filter((s) => s !== ALL) : []);

// « x/all/y » dépend de « x/public/y » s'il existe dans la liste.
const getAllDependencies = (scope: string, scopes: readonly unknown[]): string[] => {
  const arrayKey = scope.split('/');
  const depScope = `${arrayKey.slice(0, 1).join('/')}/public/${arrayKey.slice(2).join('/')}`;
  return arrayKey[1] === 'all' && scopes.includes(depScope) ? [depScope] : [];
};

// _.chain(scopes).keyBy(s => s).mapValues(…) : une entrée par scope distinct, dans l'ordre.
const getScopesDependencies = (scopes: readonly unknown[]): Record<string, unknown[]> => {
  const out: Record<string, unknown[]> = {};
  for (const scope of scopes) {
    const key = String(scope);
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;
    assignValue(out, key, []);
  }
  for (const key of Object.keys(out)) {
    assignValue(out, key, [...getWriteDependencies(key, scopes), ...getAllDependencies(key, scopes), ...getAllAllDependencies(key, scopes)]);
  }
  return out;
};

const uniq = <T>(values: readonly T[]): T[] => {
  const out: T[] = [];
  for (const value of values) if (!out.some((v) => Object.is(v, value) || (v === 0 && value === 0))) out.push(value);
  return out;
};

/**
 * Scopes requis par `scope` (récursivement). Le résultat peut contenir des doublons (comme l'original :
 * dépendances directes, puis dépendances de celles-ci dédoublonnées entre elles seulement).
 * Lève une TypeError si `scope` n'est pas dans `scopes`.
 */
export const getScopeDependencies = (scopes: readonly unknown[] = orgScopes) => (scope: string): unknown[] => {
  // Lecture par table[scope] : une clé héritée (« constructor »…) y renvoie la valeur héritée.
  const dependencies = (getScopesDependencies(scopes) as Record<string, unknown>)[scope] as { length: number };
  if (dependencies.length === 0) return [];
  const sub = uniq(lodashMap(dependencies, (dependency) => getScopeDependencies(scopes)(dependency as string)).flat());
  return [...toConsumableArray(dependencies), ...toConsumableArray(sub)];
};

// _.map : tableau ou valeur « array-like » par indices, objet ou fonction par clés propres.
const lodashMap = (collection: unknown, iteratee: (value: unknown) => unknown[]): unknown[][] => {
  if (collection === null || collection === undefined) return [];
  if (typeof collection !== 'function' && Number.isSafeInteger((collection as { length?: unknown }).length) && ((collection as { length: number }).length >= 0)) {
    return Array.from({ length: (collection as { length: number }).length }, (_, i) => iteratee((collection as Record<number, unknown>)[i]));
  }
  return Object.keys(collection).map((key) => iteratee((collection as Record<string, unknown>)[key]));
};

/** Scopes qui dépendent de `scope` (récursivement), même règle de doublons. */
export const getScopeDependents = (scopes: readonly unknown[] = orgScopes) => (scope: unknown): string[] => {
  const all = getScopesDependencies(scopes);
  const dependents = Object.keys(all).filter((key) => (all[key] ?? []).includes(scope));
  const sub = uniq(dependents.flatMap((dependent) => getScopeDependents(scopes)(dependent)));
  return [...dependents, ...sub];
};

/**
 * Nouvelle liste de scopes d'un rôle quand on coche (`checked`) ou décoche `scope` dans le formulaire :
 * cocher ajoute aussi ses dépendances ; décocher retire le scope et ses dépendants, ainsi que ses
 * dépendances (et leurs dépendants) si elles étaient toutes cochées.
 * L'ordre est celui du Set Immutable du front (voir immutable-set.ts) : il est enregistré tel quel.
 */
export const generateNewScopes = (oldScopes: readonly string[], scope: string, checked: boolean): string[] => {
  const old = new ImmutableStringSet(oldScopes);
  if (checked) {
    const scopeDependencies = getScopeDependencies()(scope) as string[];
    return old.union(new ImmutableStringSet([scope, ...scopeDependencies])).values();
  }

  let newScopesAll: ImmutableStringSet;
  const dependencies = getScopeDependencies()(scope) as string[];
  const oldValues = old.values();
  if (dependencies.filter((dependency) => !oldValues.includes(dependency)).length === 0) {
    const dependenciesDependents = dependencies.flatMap((dependency) => getScopeDependents()(dependency));
    newScopesAll = old.subtract(new ImmutableStringSet([...dependencies, ...dependenciesDependents]));
  } else {
    newScopesAll = old;
  }
  const scopeDependents = getScopeDependents()(scope);
  return newScopesAll.subtract(new ImmutableStringSet([scope, ...scopeDependents])).values();
};

/** Scopes groupés par préfixe (tout sauf le dernier segment) : une ligne du tableau des rôles. */
export const groupScopes = (scopes: readonly string[] = orgScopes): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const item of scopes) {
    const key = item.split('/').slice(0, -1).join('/');
    if (Object.prototype.hasOwnProperty.call(out, key)) out[key]?.push(item);
    else assignValue(out, key, [item]);
  }
  return out;
};

/** Libellé d'une ligne du tableau des rôles (undefined si le groupe est inconnu). */
export const getRowLabel = (key: string): unknown => (roleGroupNames as Record<string, unknown>)[key];

// lodash words() pour une chaîne ASCII (les autres caractères ne sont pas pris en charge).
const RE_HAS_UNICODE_WORD = /[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/;
// eslint-disable-next-line no-control-regex -- expression d'origine de lodash (reAsciiWord)
const RE_ASCII_WORD = /[^\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g;
const RE_UNICODE_WORD = /[A-Z]?[a-z]+(?=[^A-Za-z0-9]|[A-Z]|$)|[A-Z]+(?=[^A-Za-z0-9]|[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]+|\d*(?:1ST|2ND|3RD|(?![123])\dTH)(?=\b|[a-z_])|\d*(?:1st|2nd|3rd|(?![123])\dth)(?=\b|[A-Z_])|\d+/g;
const words = (value: string): string[] => (RE_HAS_UNICODE_WORD.test(value) ? value.match(RE_UNICODE_WORD) : value.match(RE_ASCII_WORD)) ?? [];
const lowerCase = (value: string): string => words(value.replace(/['’]/g, '')).map((word) => word.toLowerCase()).join(' ');
const startCase = (value: string): string => words(value.replace(/['’]/g, '')).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/** Libellé d'une case : View, Edit, ou le dernier segment en « Start Case » (ex. Manage). */
export const getLabel = (key: string): string => {
  const last = key.split('/').at(-1) ?? '';
  switch (last) {
    case 'view': return 'View';
    case 'edit': return 'Edit';
    default: return startCase(lowerCase(last));
  }
};

// --- Scopes effectifs et vérifications ----------------------------------------------------------

/**
 * Scopes d'un jeton d'organisation : union (sans doublon, dans l'ordre) des scopes des rôles de
 * l'utilisateur dans l'organisation, suivie des scopes propres de l'utilisateur (doublons possibles).
 * L'ordre des rôles est celui renvoyé par la base (Role.find).
 */
export const getOrganisationTokenScopes = (roleScopes: readonly (readonly string[])[], userScopes: readonly string[]): string[] => [
  ...uniq(roleScopes.flat()),
  ...userScopes,
];

const intersects = (required: readonly string[], active: unknown): boolean =>
  Array.isArray(active) && required.some((scope) => active.includes(scope));

/** canViewModel : `org/all/<modèle>/manage`, site_admin ou all. */
export const canViewModel = (modelName: string, activeScopes: unknown): boolean =>
  intersects([`org/all/${modelName}/manage`, SITE_ADMIN, ALL], activeScopes);

/**
 * canCreateOrganisations : org/all/organisation/manage, site_admin, site_can_create_org, et `all`
 * seulement si `restrictCreateOrganisation` est faux. Le serveur d'origine lit la variable
 * RESTRICT_CREATE_ORGANISATION avec le paquet « boolean » (voir parseBooleanEnv), vrai par défaut.
 */
export const canCreateOrganisations = (activeScopes: unknown, { restrictCreateOrganisation = true }: { restrictCreateOrganisation?: unknown } = {}): boolean =>
  intersects(['org/all/organisation/manage', SITE_ADMIN, SITE_CAN_CREATE_ORG, ...(restrictCreateOrganisation ? [] : [ALL])], activeScopes);

/** Paquet « boolean » 0.1.3 : lecture d'une variable d'environnement booléenne (true, t, yes, y, 1). */
export const parseBooleanEnv = (value: unknown): boolean => {
  if (typeof value === 'string') return /^(true|t|yes|y|1)$/i.test(value.trim());
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'boolean') return value;
  return false;
};
