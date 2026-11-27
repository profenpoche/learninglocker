// Utilitaires purs du query builder : critères d'une requête (`$comment`), ajout d'un jeton depuis
// l'explorateur, ajout/suppression d'un critère, description lisible, détection des `$dte`.
// Code d'origine : legacy/ui/src/utils/queries/index.js et legacy/ui/src/utils/queries/has$dte.js.
//
// Les entrées et sorties sont du JSON (Immutable.fromJS / toJS à l'origine). Les « criteria » sont une
// Map Immutable dont les clés sont des Map { criterionLabel, criteriaPath } : leur ordre d'itération
// (donc l'ordre des critères dans `$and`) suit le hachage Immutable, reproduit par ImmutableMapSim.
// Comportements d'origine reproduits, entre autres :
// - une valeur scalaire rencontrée en parcourant une requête REMET À ZÉRO les critères déjà trouvés ;
// - `tokenValues.has(tokenValue)` teste un INDICE de List : le jeton est donc toujours ajouté, même
//   s'il est déjà présent ;
// - un ancien `$comment` (« statement.verb ») est converti au format JSON avec un nouveau libellé.

import { ImmutableMapSim } from '../immutable-map.js';
import { immutableIs } from '../immutable-set.js';
import { fromJS, isList, isMap, mapFromEntries, sizeOf, toJS, type IMap } from '../visualisations/immutable.js';

type Criteria = ImmutableMapSim;

const typeError = (what: string): TypeError => new TypeError(`${what} is not a function`);

const mapOf = (entries: readonly (readonly [string, unknown])[]): IMap => mapFromEntries(entries);

// new List(valeur) : tableau tel quel, chaîne → caractères, null/undefined → vide ; sinon TypeError.
const listOf = (value: unknown): unknown[] => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value as unknown[];
  // Itérateur de chaîne : points de code (comme IterableSeq d'Immutable).
  if (typeof value === 'string') return Array.from(value);
  throw new TypeError(`Expected Array or iterable object of values: ${JSON.stringify(value)}`);
};

const get = (map: unknown, key: string, notSetValue?: unknown): unknown => {
  if (isMap(map)) return Object.hasOwn(map, key) ? map[key] : notSetValue;
  if (isList(map)) return notSetValue;
  throw typeError('get');
};

const has = (collection: unknown, key: string): boolean => {
  if (isMap(collection)) return Object.hasOwn(collection, key);
  if (isList(collection)) {
    const index = Number(key) >>> 0;
    return String(index) === key && index < collection.length;
  }
  throw typeError('has');
};

// map.set(key, value) : une clé existante garde sa place.
const setKey = (map: IMap, key: string, value: unknown): IMap => {
  if (Object.hasOwn(map, key)) {
    const out = mapOf(Object.keys(map).map((k) => [k, map[k]]));
    out[key] = value;
    return out;
  }
  return mapOf([...Object.keys(map).map((k) => [k, map[k]] as const), [key, value]]);
};

// JSON.stringify(Map { criterionLabel, criteriaPath }) (toJSON profond).
const stringifyKey = (key: IMap): string => JSON.stringify(toJS(key));

// --- Libellés A, B, … Z, AA… -------------------------------------------------------------------------

const incrementLetter = (letter: string): string => String.fromCharCode(letter.charCodeAt(0) + 1);

const incrementLabel = (label: unknown): string => {
  const text = label as string;
  const init = text.slice(0, -1);
  const last = text[text.length - 1];
  if (last === 'Z') return `${incrementLabel(init)}A`;
  if (last === undefined) return 'A';
  return init + incrementLetter(last);
};

// Immutable sort (defaultComparator, tri stable).
const defaultComparator = (a: unknown, b: unknown): number => ((a as number) > (b as number) ? 1 : (a as number) < (b as number) ? -1 : 0);

const getNextLabel = (criteria: Criteria): string => {
  const labels = criteria.entries().map(([key]) => get(key, 'criterionLabel'));
  const sorted = labels.map((label, index) => ({ label, index })).sort((a, b) => defaultComparator(a.label, b.label) || a.index - b.index);
  const lastLabel = sorted.at(-1)?.label;
  return incrementLabel(lastLabel || '');
};

// --- Lecture des critères ------------------------------------------------------------------------

const criterionKeyOf = (criterionLabel: unknown, criteriaPath: unknown): IMap =>
  mapOf([['criterionLabel', criterionLabel], ['criteriaPath', criteriaPath]]);

const getCriterionFromOldComment = (map: IMap, criteria: Criteria): Criteria => {
  const comment = map.$comment as { split: (separator: string) => unknown };
  const criteriaKey = criterionKeyOf(getNextLabel(criteria), listOf(comment.split('.')));
  const criteriaMap = setKey(map, '$comment', stringifyKey(criteriaKey));
  return criteria.clone().set(criteriaKey, criteriaMap);
};

const getCriterionFromNewComment = (map: IMap, criteria: Criteria): Criteria => {
  const comment = JSON.parse(map.$comment as string) as { criterionLabel: unknown; criteriaPath: unknown };
  const criteriaKey = criterionKeyOf(comment.criterionLabel, listOf(comment.criteriaPath));
  return criteria.clone().set(criteriaKey, map);
};

const getCriterionFromComment = (map: IMap, criteria: Criteria): Criteria => {
  const comment = map.$comment;
  if (comment === null || comment === undefined) throw new TypeError(`Cannot read property '0' of ${String(comment)}`);
  // comment[0] : premier caractère d'une chaîne ; undefined pour une collection ou un scalaire.
  const first = typeof comment === 'string' ? comment[0] : undefined;
  if (first !== '{') return getCriterionFromOldComment(map, criteria);
  return getCriterionFromNewComment(map, criteria);
};

const getCriteriaFromQuery = (query: unknown, criteria: Criteria): Criteria => {
  if (isMap(query)) {
    const keys = Object.keys(query);
    if (keys.includes('$comment')) return getCriterionFromComment(query, criteria);
    return keys.reduce((result, key) => getCriteriaFromQuery(query[key], result), criteria);
  }
  if (isList(query)) return query.reduce<Criteria>((result, value) => getCriteriaFromQuery(value, result), criteria);
  // Valeur scalaire : nouvelle Map vide (les critères accumulés sont perdus).
  return new ImmutableMapSim();
};

const getCriteriaInternal = (query: unknown): Criteria => getCriteriaFromQuery(query, new ImmutableMapSim());

/** Un critère : sa clé `{ criterionLabel, criteriaPath }` et son contenu (avec `$comment`). */
export interface CriterionEntry {
  key: { criterionLabel: unknown; criteriaPath: unknown[] };
  criterion: unknown;
}

const toEntries = (criteria: Criteria): CriterionEntry[] =>
  criteria.entries().map(([key, criterion]) => ({ key: toJS(key) as CriterionEntry['key'], criterion: toJS(criterion) }));

/** Critères d'une requête, dans l'ordre d'itération de la Map Immutable d'origine. */
export const getCriteria = (query: unknown): CriterionEntry[] => toEntries(getCriteriaInternal(fromJS(query)));

const changeCriteriaInternal = (criteria: Criteria): IMap =>
  criteria.size > 0 ? mapOf([['$and', criteria.entries().map(([, criterion]) => criterion)]]) : mapOf([]);

/** Requête reconstruite : `{ $and: [critères] }`, ou `{}` sans critère. */
export const changeCriteria = (criteria: readonly CriterionEntry[]): unknown =>
  toJS(changeCriteriaInternal(new ImmutableMapSim(undefined, criteria.map(({ key, criterion }) => [fromJS(key), fromJS(criterion)] as const))));

const changeCriterion = (criteria: Criteria, criterionKey: unknown, newCriterion: unknown): IMap =>
  changeCriteriaInternal(criteria.clone().set(criterionKey, newCriterion));

/** Supprime le critère de clé `criterionKey` de la requête (deleteCriterion(getCriteria(query), key)). */
export const deleteCriterion = (query: unknown, criterionKey: { criterionLabel: unknown; criteriaPath: unknown }): unknown => {
  const criteria = getCriteriaInternal(fromJS(query)).clone().remove(fromJS(criterionKey));
  return toJS(changeCriteriaInternal(criteria));
};

// --- Ajout -----------------------------------------------------------------------------------------

const addCriterionInternal = (query: unknown, keyPath: unknown, criterion: unknown): IMap => {
  const criteria = getCriteriaInternal(query);
  const criterionKey = criterionKeyOf(getNextLabel(criteria), keyPath);
  if (!isMap(criterion)) throw typeError('criterion.merge');
  const newCriterion = setKey(criterion, '$comment', stringifyKey(criterionKey));
  return changeCriterion(criteria, criterionKey, newCriterion);
};

const listEquals = (a: unknown, b: unknown): boolean => {
  if (!isList(a)) throw typeError('keyPath.equals');
  return immutableIs(a, b);
};

const shouldUseInCriterion = (keyPath: unknown): boolean =>
  listEquals(keyPath, ['person']) || listEquals(keyPath, ['statement', 'verb']) || listEquals(keyPath, ['statement', 'object']);

// List.has(valeur) teste un indice : toujours faux pour une chaîne ou une Map.
const listHas = (list: unknown, value: unknown): boolean => {
  if (isList(list)) {
    if (typeof value === 'number') {
      // wrapIndex : un indice négatif compte depuis la fin.
      const index = value < 0 ? list.length + value : value;
      return index >= 0 && index < list.length;
    }
    if (typeof value !== 'string') return false;
    return has(list, value);
  }
  if (isMap(list)) return typeof value === 'string' && Object.hasOwn(list, value);
  throw typeError('has');
};

const push = (list: unknown, value: unknown): unknown[] => {
  if (!isList(list)) throw typeError('push');
  return [...list, value];
};

// map.setIn([k1, k2], valeur) : clés existantes à leur place.
const setIn2 = (map: IMap, k1: string, k2: string, value: unknown): IMap => {
  const inner = Object.hasOwn(map, k1) ? map[k1] : mapOf([]);
  if (!isMap(inner)) throw new Error('invalid keyPath');
  return setKey(map, k1, setKey(inner, k2, value));
};

/**
 * Ajoute un jeton (valeur cliquée dans l'explorateur) à la requête. Pour `person`, `statement.verb` et
 * `statement.object`, la valeur rejoint le `$in`/`$nin` existant ; sinon le jeton rejoint le
 * `$or`/`$nor` existant ; à défaut, un nouveau critère est créé.
 */
export const addTokenToQuery = (queryJson: unknown, keyPathJson: unknown, tokenJson: unknown): unknown => {
  const query = fromJS(queryJson);
  const keyPath = fromJS(keyPathJson);
  const token = fromJS(tokenJson);
  const criteria = getCriteriaInternal(query);
  const filtered = criteria.rebuild((entries) => entries.filter(([, criterion]) => {
    const comment = JSON.parse(get(criterion, '$comment') as string) as { criteriaPath: unknown };
    return immutableIs(listOf(comment.criteriaPath), keyPath);
  }));

  if (shouldUseInCriterion(keyPath)) {
    if (!isMap(token) || Object.keys(token).length === 0) throw new TypeError('Invalid attempt to destructure non-iterable instance');
    const tokenKey = Object.keys(token)[0] as string;
    const tokenValue = token[tokenKey];

    if (filtered.size === 0) {
      return toJS(addCriterionInternal(query, keyPath, mapOf([[tokenKey, mapOf([['$in', [tokenValue]]])]])));
    }

    const [inCriterionKey, first] = filtered.entries()[0] as [unknown, IMap];
    const op = has(get(first, tokenKey), '$in') ? '$in' : '$nin';
    const tokenValues = get(get(first, tokenKey), op);
    const newTokenValues = listHas(tokenValues, tokenValue) ? tokenValues : push(tokenValues, tokenValue);
    const newInCriterion = setIn2(first, tokenKey, op, newTokenValues);
    return toJS(changeCriterion(criteria, inCriterionKey, newInCriterion));
  }

  if (filtered.size === 0) {
    return toJS(addCriterionInternal(query, keyPath, mapOf([['$or', [token]]])));
  }

  const [criterionKey, criterion] = filtered.entries()[0] as [unknown, IMap];
  const operator = Object.hasOwn(criterion, '$nor') ? '$nor' : '$or';
  const tokens = get(criterion, operator, []);
  const newTokens = listHas(tokens, token) ? tokens : push(tokens, token);
  return toJS(changeCriterion(criteria, criterionKey, setKey(criterion, operator, newTokens)));
};

/** Ajoute un critère à la requête pour la section `{ keyPath }` du query builder. */
export const addCriterionFromSection = (query: unknown, criterion: unknown, section: unknown): unknown => {
  const sectionMap = fromJS(section);
  return toJS(addCriterionInternal(fromJS(query), get(sectionMap, 'keyPath', []), fromJS(criterion)));
};

// --- Description -------------------------------------------------------------------------------------

const lastKey = (map: IMap): string | undefined => Object.keys(map).at(-1);

const is$orCriterion = (criterion: unknown): boolean => isMap(criterion) && (Object.hasOwn(criterion, '$nor') || Object.hasOwn(criterion, '$or'));

const is$inCriterion = (criterion: IMap): boolean => {
  const query = criterion[lastKey(criterion) ?? ''];
  return isMap(query) && (Object.hasOwn(query, '$nin') || Object.hasOwn(query, '$in'));
};

const countValues = (criterion: IMap): unknown => {
  if (is$orCriterion(criterion)) return sizeOf(get(criterion, Object.hasOwn(criterion, '$nor') ? '$nor' : '$or', []));
  const query = criterion[lastKey(criterion) ?? ''];
  const op = isMap(query) && Object.hasOwn(query, '$nin') ? '$nin' : '$in';
  return sizeOf(isMap(query) && Object.hasOwn(query, op) ? query[op] : []);
};

const plural = (size: unknown): string => (size === 1 ? '' : 's');

const criterionToString = (criterion: unknown, criterionKey: IMap): string => {
  const path = (criterionKey.criteriaPath as unknown[]).join('.');
  if (isMap(criterion) && (is$orCriterion(criterion) || is$inCriterion(criterion))) {
    const size = countValues(criterion);
    return `${path} (${String(size)} item${plural(size)})`;
  }
  return path;
};

/** Description lisible des critères : « chemin » ou « chemin (n items) ». */
export const queryToStringList = (query: unknown): string[] =>
  getCriteriaInternal(fromJS(query)).entries().map(([key, criterion]) => criterionToString(criterion, key as IMap));

/** Vrai si la requête contient une clé `$dte` à une profondeur quelconque. */
export const has$dte = (query: unknown): boolean => {
  const check = (value: unknown): boolean => {
    if (isMap(value)) return Object.hasOwn(value, '$dte') || Object.keys(value).some((key) => check(value[key]));
    if (isList(value)) return value.some(check);
    return false;
  };
  return check(fromJS(query));
};
