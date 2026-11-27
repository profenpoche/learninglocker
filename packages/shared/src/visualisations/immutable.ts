// Émulation, sur des objets et tableaux simples, des comportements d'Immutable 3.8.2 dont dépend la
// forme exacte des pipelines (immutable/dist/immutable.js : fromJS, Map, List, getIn, toJS, hash).
// Le code d'origine manipule des Map/List Immutable ; ici :
//   - une Map est un objet sans prototype (Object.create(null)) : « __proto__ » y est une clé ordinaire,
//     comme dans une Map Immutable ;
//   - une List est un tableau ;
//   - un objet JSON qui possède une clé propre « constructor » n'est PAS converti par fromJS
//     (isPlainObj teste value.constructor === Object) : il reste un objet JS « brut », marqué dans RAW.
//
// Ordre des clés : une Map Immutable de 8 entrées au plus garde l'ordre d'insertion (ArrayMapNode) ;
// au-delà, c'est un HAMT et l'itération (donc toJS) suit le hash des clés. immutableKeyOrder reproduit
// cet ordre ; vérifié contre le vrai code (voir tools/oracle/pipelines.mjs et les fixtures).

/** Marqueur « clé absente » de getIn/get. */
export const NOT_SET: unique symbol = Symbol('NOT_SET');
export type NotSet = typeof NOT_SET;

/** Map Immutable émulée : objet sans prototype. */
export type IMap = Record<string, unknown>;

const RAW = new WeakSet<object>();

/** Objet JS « simple » (prototype Object.prototype ou null). */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/** Vrai si la valeur se comporte comme une Map Immutable (objet simple non « brut »). */
export const isMap = (value: unknown): value is IMap => isPlainObject(value) && !RAW.has(value);

/** Vrai si la valeur se comporte comme une List Immutable. */
export const isList = (value: unknown): value is unknown[] => Array.isArray(value);

// --- Ordre d'itération des Map Immutable --------------------------------------------------------

// smi() et hashString() d'Immutable 3.8.2 (hash « JVM » des chaînes).
const smi = (i32: number): number => ((i32 >>> 1) & 0x40000000) | (i32 & 0xbfffffff);

export const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (31 * hash + value.charCodeAt(i)) | 0;
  }
  return smi(hash);
};

const MAX_ARRAY_MAP_SIZE = 8;

/**
 * Ordre d'itération d'une Map Immutable 3.8.2 construite en insérant `keys` dans cet ordre
 * (clés distinctes, sans suppression).
 *
 * - 8 clés au plus : ordre d'insertion.
 * - Au-delà : tri par fragments de 5 bits du hash, du poids faible au poids fort (parcours du HAMT).
 *   À hash égal (collision), ordre d'insertion, sauf que la 9e clé passe en tête : createNodes()
 *   l'insère avant les 8 premières lors de la conversion ArrayMapNode → HAMT.
 */
export const immutableKeyOrder = (keys: readonly string[]): string[] => {
  if (keys.length <= MAX_ARRAY_MAP_SIZE) return [...keys];
  const sequence = [...keys.slice(MAX_ARRAY_MAP_SIZE, MAX_ARRAY_MAP_SIZE + 1), ...keys.slice(0, MAX_ARRAY_MAP_SIZE), ...keys.slice(MAX_ARRAY_MAP_SIZE + 1)];
  const rank = new Map(sequence.map((key, index) => [key, index]));
  const hashes = new Map(keys.map((key) => [key, hashString(key)]));
  return [...keys].sort((a, b) => {
    const ha = hashes.get(a) ?? 0;
    const hb = hashes.get(b) ?? 0;
    if (ha === hb) return (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
    for (let shift = 0; shift <= 30; shift += 5) {
      const diff = ((ha >>> shift) & 31) - ((hb >>> shift) & 31);
      if (diff !== 0) return diff;
    }
    return 0;
  });
};

/** Construit une Map à partir d'entrées insérées dans l'ordre donné (Map(seq), reify, mapEntries…). */
export const mapFromEntries = (entries: readonly (readonly [string, unknown])[]): IMap => {
  // Dernière valeur pour une clé répétée, position de la première (Map.set sur une clé existante).
  const values = new Map<string, unknown>();
  for (const [key, value] of entries) values.set(key, value);
  const out: IMap = Object.create(null) as IMap;
  for (const key of immutableKeyOrder([...values.keys()])) {
    out[key] = values.get(key);
  }
  return out;
};

// --- fromJS / toJS --------------------------------------------------------------------------------

/** Équivalent de isPlainObj d'Immutable : value.constructor === Object ou undefined. */
export const isImmutablePlainObj = (value: object): boolean => {
  const ctor = (value as { constructor?: unknown }).constructor;
  return ctor === Object || ctor === undefined;
};

/**
 * Immutable.fromJS(json) sans reviver, sur une valeur JSON : objets → Map (ordre Immutable),
 * tableaux → List ; un objet avec une clé « constructor » reste brut (non converti, contenu compris).
 */
export const fromJS = (json: unknown): unknown => {
  if (Array.isArray(json)) return json.map((item: unknown) => fromJS(item));
  if (json !== null && typeof json === 'object') {
    if (RAW.has(json) || !isImmutablePlainObj(json)) {
      RAW.add(json);
      return json;
    }
    return mapFromEntries(Object.keys(json).map((key) => [key, fromJS((json as Record<string, unknown>)[key])]));
  }
  return json;
};

/** Marque un objet comme « brut » (non converti par fromJS). Usage interne au reviver. */
export const markRaw = (value: object): void => {
  RAW.add(value);
};

/**
 * Immutable toJS() : Map → objet (affectation clé par clé, comme Map.toObject : une clé « __proto__ »
 * change donc le prototype et disparaît de JSON.stringify), List → tableau, le reste tel quel.
 */
export const toJS = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item: unknown) => toJS(item));
  // Autres collections émulées (Set…) : méthode toJS, comme Immutable.
  if (value !== null && typeof value === 'object' && !isPlainObject(value) && typeof (value as { toJS?: unknown }).toJS === 'function') {
    return (value as { toJS: () => unknown }).toJS();
  }
  if (isMap(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = toJS(value[key]);
    }
    return out;
  }
  return value;
};

// --- Accès -----------------------------------------------------------------------------------------

// wrapIndex d'Immutable pour List.get avec une clé chaîne.
const listIndex = (key: string): number => {
  const uint32 = Number(key) >>> 0;
  if (String(uint32) !== key || uint32 === 4294967295) return Number.NaN;
  return uint32;
};

/**
 * `collection.get(key, NOT_SET)` quand `collection.get` existe ; `undefined` sinon (la méthode
 * n'existe pas). Lève une TypeError, comme le code d'origine, si un objet brut a une propriété
 * « get » qui n'est pas une fonction.
 */
const getMethod = (collection: unknown, key: string): unknown => {
  if (isMap(collection)) return Object.hasOwn(collection, key) ? collection[key] : NOT_SET;
  if (isList(collection)) {
    const index = listIndex(key);
    return index < collection.length ? collection[index] : NOT_SET;
  }
  if (collection !== null && typeof collection === 'object') {
    const method = (collection as { get?: unknown }).get;
    if (method) throw new TypeError('nested.get is not a function');
  }
  return undefined;
};

/** Immutable `Map.get(key, notSetValue)` sur une Map émulée. */
export const get = (map: IMap, key: string, notSetValue?: unknown): unknown => (Object.hasOwn(map, key) ? map[key] : notSetValue);

/**
 * Immutable `getIn(path, notSetValue)` :
 * `nested = nested && nested.get ? nested.get(key, NOT_SET) : NOT_SET`.
 * Une valeur nulle ou sans méthode get donne `notSetValue` ; une valeur présente mais nulle en fin de
 * chemin est renvoyée telle quelle.
 */
export const getIn = (collection: unknown, path: readonly string[], notSetValue: unknown): unknown => {
  let nested: unknown = collection;
  for (const key of path) {
    const hasGet = Boolean(nested) && (isMap(nested) || isList(nested) || (typeof nested === 'object' && Boolean((nested as { get?: unknown }).get)));
    nested = hasGet ? getMethod(nested, key) : NOT_SET;
    if (nested === NOT_SET) return notSetValue;
  }
  return nested;
};

/**
 * `value.size` d'Immutable : nombre de clés d'une Map, longueur d'une List, propriété `size` d'un objet
 * brut ; `undefined` pour une valeur scalaire. Lève une TypeError sur null/undefined, comme l'original.
 */
export const sizeOf = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${String(value)} (reading 'size')`);
  }
  if (isMap(value)) return Object.keys(value).length;
  if (isList(value)) return value.length;
  if (typeof value === 'object') return (value as { size?: unknown }).size;
  return undefined;
};

const quoteString = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : immutableToString(value));

/**
 * `String(valeur)` comme dans le code d'origine : toString() d'Immutable 3.8.2 pour une Map
 * (« Map { "a": 1 } ») ou une List (« List [ 1, "x" ] »), conversion JS native sinon (un objet brut
 * donne « [object Object] », ou une TypeError s'il a une clé « toString »).
 */
export const immutableToString = (value: unknown): string => {
  if (isMap(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return 'Map {}';
    return `Map { ${keys.map((key) => `${JSON.stringify(key)}: ${quoteString(value[key])}`).join(', ')} }`;
  }
  if (isList(value)) {
    if (value.length === 0) return 'List []';
    return `List [ ${value.map(quoteString).join(', ')} ]`;
  }
  return String(value);
};

/**
 * Clé de propriété JS d'une valeur, comme `obj[valeur]` ou `` `$${valeur}` `` dans le code d'origine
 * (conversion par toString() : voir immutableToString).
 */
export const toPropertyKey = (value: unknown): string => immutableToString(value);
