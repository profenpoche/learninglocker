// Équivalents exacts des fonctions lodash 4.17.21 utilisées par les helpers de requête du serveur
// (lib/helpers/*.js) : chemins (has/get/set), isPlainObject, mapValues. Leur sémantique fine compte
// pour l'identité des requêtes produites (clés avec des points, « __proto__ », objets non simples).

/** Valeurs à ne jamais parcourir (ObjectId créés par la fabrique de l'appelant, par exemple). */
const OPAQUE = new WeakSet<object>();

export const markOpaque = <T>(value: T): T => {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) OPAQUE.add(value);
  return value;
};

const objectCtorString = Function.prototype.toString.call(Object);

/** _.isPlainObject : objet dont le prototype est null ou a pour constructeur Object. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || OPAQUE.has(value)) return false;
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto === null) return true;
  const ctor: unknown = Object.prototype.hasOwnProperty.call(proto, 'constructor') ? (proto as { constructor: unknown }).constructor : false;
  return typeof ctor === 'function' && ctor instanceof ctor && Function.prototype.toString.call(ctor) === objectCtorString;
};

const reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/;
const reIsPlainProp = /^\w*$/;

// isKey + castPath, pour les chemins de ce module (chaînes simples à points, ou tableaux de clés).
const castPath = (path: string | readonly string[], object: unknown): string[] => {
  if (typeof path !== 'string') return [...path];
  const isKey = reIsPlainProp.test(path) || !reIsDeepProp.test(path) || (object !== null && object !== undefined && path in Object(object));
  return isKey ? [path] : path.split('.');
};

const hasOwn = (object: unknown, key: string): boolean => object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key);

/** _.has(object, path) : chemin de propriétés propres. */
export const has = (object: unknown, path: string | readonly string[]): boolean => {
  const keys = castPath(path, object);
  let current: unknown = object;
  let result = false;
  for (const key of keys) {
    result = hasOwn(current, key);
    if (!result) break;
    current = (current as Record<string, unknown>)[key];
  }
  return result;
};

/** _.get(object, path, defaultValue) : lecture par `objet[clé]` (propriétés héritées comprises). */
export const get = (object: unknown, path: string | readonly string[], defaultValue?: unknown): unknown => {
  const keys = castPath(path, object);
  let current: unknown = object;
  let index = 0;
  while (current !== null && current !== undefined && index < keys.length) {
    current = (current as Record<string, unknown>)[keys[index] ?? ''];
    index += 1;
  }
  const result = index > 0 && index === keys.length ? current : undefined;
  return result === undefined ? defaultValue : result;
};

const isObject = (value: unknown): value is object => value !== null && (typeof value === 'object' || typeof value === 'function');

// baseAssignValue : « __proto__ » est défini comme propriété propre, pas comme prototype.
export const assignValue = (object: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(object, key, { configurable: true, enumerable: true, value, writable: true });
  } else {
    object[key] = value;
  }
};

/** _.set(object, path, value) : modifie `object` et le renvoie. */
export const set = (object: unknown, path: readonly string[], value: unknown): unknown => {
  if (!isObject(object)) return object;
  let nested: unknown = object;
  const lastIndex = path.length - 1;
  for (let index = 0; nested !== null && nested !== undefined && index < path.length; index += 1) {
    const key = path[index] ?? '';
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return object;
    let newValue = value;
    if (index !== lastIndex) {
      const objValue = (nested as Record<string, unknown>)[key];
      newValue = isObject(objValue) ? objValue : /^(?:0|[1-9]\d*)$/.test(path[index + 1] ?? '') ? [] : {};
    }
    const target = nested as Record<string, unknown>;
    const current = target[key];
    if (!(hasOwn(target, key) && (current === newValue || (Number.isNaN(current) && Number.isNaN(newValue)))) || (newValue === undefined && !(key in target))) {
      assignValue(target, key, newValue);
    }
    nested = target[key];
  }
  return object;
};

/** _.mapValues(object, iteratee) sur un objet simple. */
export const mapValues = (object: Record<string, unknown>, iteratee: (value: unknown, key: string) => unknown): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(object)) {
    assignValue(result, key, iteratee(object[key], key));
  }
  return result;
};

// --- Sémantique du code legacy transpilé (Babel 6, preset env + transform-runtime) -------------------
// Le serveur et le front legacy exécutent du ES5 transpilé, dont certaines constructions diffèrent du
// JavaScript natif sur des cas limites :
//   - `[...x]` devient `_toConsumableArray(x)` : copie d'un tableau, sinon Array.from(x) (une chaîne
//     donne ses caractères, un objet sans longueur un tableau vide, null une TypeError) ;
//   - `{ ...a, k: v }` devient `_extends({}, a, { k: v })`, soit Object.assign : une clé propre
//     « __proto__ » y est affectée par [[Set]] et change le prototype au lieu d'être copiée.

/** `[...value]` transpilé (babel-runtime/helpers/toConsumableArray). */
export const toConsumableArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? [...(value as unknown[])] : Array.from(value as ArrayLike<unknown>);
