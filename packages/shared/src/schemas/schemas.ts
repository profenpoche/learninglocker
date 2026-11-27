// Sérialisation des modèles par le front : preSave (modèle → corps envoyé à l'API, donc format écrit
// en base) et reviver (document reçu de l'API → modèle du front).
// Code d'origine : legacy/ui/src/utils/schemas.js (LLSchema, schémas et leurs preSave/reviver),
// appliqués comme dans legacy/ui/src/redux/modules/models/entityReviver.js
// (Immutable.fromJS(document, schema.reviver)) et addModel/saveModel (schema.preSave(modèle).toJS()).
//
// Les entrées et sorties sont du JSON simple. Les comportements Immutable qui changent le résultat
// sont reproduits (voir visualisations/immutable.ts et immutable-set.ts) : ordre des clés au-delà de
// 8, objets « bruts » (clé « constructor »), Set (dédoublonnage et ordre de hachage), OrderedMap.

import { ImmutableSet, ORDERED_MAPS, VALUE_OPS } from '../immutable-set.js';
import { axesToJsList } from '../visualisations/axes.js';
import {
  fromJS,
  isImmutablePlainObj,
  isList,
  isMap,
  mapFromEntries,
  markRaw,
  sizeOf,
  toJS,
  type IMap,
} from '../visualisations/immutable.js';
import { reviveVisualisationInternal } from '../visualisations/revive.js';

/** Schémas exportés par ui/src/utils/schemas.js. */
export const SCHEMA_NAMES = [
  'user', 'lrs', 'organisation', 'statement', 'visualisation', 'stream', 'streamOutcome', 'persona', 'query',
  'personaAttribute', 'personaIdentifier', 'scoredPersonas', 'importcsv', 'client', 'dashboard', 'export',
  'download', 'querybuildercache', 'querybuildercachevalue', 'aggregation', 'globalError', 'role',
  'statementForwarding', 'personasImport', 'siteSettings',
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

const isSchemaName = (name: string): name is SchemaName => (SCHEMA_NAMES as readonly string[]).includes(name);

// --- Opérations Immutable sur les valeurs émulées ------------------------------------------------

const NOT_SET = Symbol('NOT_SET');

// wrapIndex d'Immutable (List.get/List.set avec une clé chaîne).
const listIndex = (key: string): number => {
  const uint32 = Number(key) >>> 0;
  return String(uint32) !== key || uint32 === 4294967295 ? Number.NaN : uint32;
};

const typeError = (method: string): TypeError => new TypeError(`${method} is not a function`);

/** `collection.get(key, notSetValue)`. */
const imGet = (collection: unknown, key: string, notSetValue: unknown): unknown => {
  if (isMap(collection)) return Object.hasOwn(collection, key) ? collection[key] : notSetValue;
  if (isList(collection)) {
    const index = listIndex(key);
    return index < collection.length ? collection[index] : notSetValue;
  }
  throw typeError('get');
};

/** `map.set(key, value)` : une clé existante garde sa place. */
const setKey = (map: IMap, key: string, value: unknown): IMap => {
  if (Object.hasOwn(map, key)) {
    const out = mapFromEntries(Object.keys(map).map((k) => [k, map[k]]));
    out[key] = value;
    return out;
  }
  return mapFromEntries([...Object.keys(map).map((k) => [k, map[k]] as const), [key, value]]);
};

/** `collection.set(key, value)` (List : indice entier, sinon collection inchangée). */
const imSet = (collection: unknown, key: string, value: unknown): unknown => {
  if (isMap(collection)) return setKey(collection, key, value);
  if (isList(collection)) {
    const index = listIndex(key);
    if (Number.isNaN(index)) return collection;
    const out = [...collection];
    out[index] = value;
    return Array.from(out, (item: unknown) => item);
  }
  throw typeError('set');
};

/**
 * `collection.update(key, notSetValue, updater)` (updateInDeepMap) : si l'updater renvoie la valeur
 * lue (===), la collection est inchangée ; sinon la clé est (re)définie.
 */
const imUpdate = (collection: unknown, key: string, notSetValue: unknown, updater: (value: unknown) => unknown): unknown => {
  if (!(isMap(collection) || isList(collection))) throw typeError('update');
  const existing = imGet(collection, key, NOT_SET);
  const existingValue = existing === NOT_SET ? notSetValue : existing;
  const newValue = updater(existingValue);
  const nextUpdated = sameValue(newValue, existingValue) ? existing : newValue;
  if (nextUpdated === existing) return collection;
  return imSet(collection, key, nextUpdated);
};

/**
 * `===` entre valeurs Immutable : la List vide et la Map vide sont des singletons (emptyList(),
 * emptyMap()), quel que soit le chemin qui les produit (fromJS([]), new List(), list.map(…)…).
 */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (isList(a) && isList(b)) return a.length === 0 && b.length === 0;
  if (isMap(a) && isMap(b)) return Object.keys(a).length === 0 && Object.keys(b).length === 0 && !ORDERED_MAPS.has(a) && !ORDERED_MAPS.has(b);
  return false;
};

/** `collection.map(fn)` d'une List ou d'une Map. */
const imMap = (collection: unknown, fn: (value: unknown) => unknown): unknown => {
  if (isList(collection)) return collection.map((value: unknown) => fn(value));
  if (isMap(collection)) return mapFromEntries(Object.keys(collection).map((key) => [key, fn(collection[key])]));
  throw typeError('map');
};

/** `value.toJS()` : TypeError si la valeur n'est pas une collection. */
const imToJS = (value: unknown): unknown => {
  if (isMap(value) || isList(value) || value instanceof ImmutableSet) return toJS(value);
  throw typeError('toJS');
};

/** `JSON.stringify(valeur)` : une collection Immutable est sérialisée par son toJSON (profond). */
const stringify = (value: unknown): string => JSON.stringify(isMap(value) || isList(value) || value instanceof ImmutableSet ? toJS(value) : value);

/** `filter.size > 0 ? JSON.stringify(filter.toJS()) : JSON.stringify(filter)` (user, query, dashboard). */
const stringifyIfNotEmpty = (filter: unknown): string => ((sizeOf(filter) as number) > 0 ? JSON.stringify(imToJS(filter)) : stringify(filter));

// `JSON.parse(valeur)` des revivers : une valeur non textuelle est convertie en chaîne ; une collection
// (« Map { … } », « List [ … ] ») n'est jamais du JSON valide.
const parseLoose = (value: unknown): unknown => {
  if (value !== null && typeof value === 'object') throw new SyntaxError('Unexpected token in JSON');
  return JSON.parse(String(value)) as unknown;
};

// --- preSave ---------------------------------------------------------------------------------------

const preSaveVisualisation = (model: IMap | unknown[]): unknown => {
  let out = imUpdate(model, 'filters', fromJS([{ $match: {} }]), (filters) => imMap(filters, (query) => JSON.stringify(imToJS(query))));
  out = imUpdate(out, 'axes', mapFromEntries([]), (axes) => JSON.stringify(imToJS(axes)));
  // merge des champs d'axes du modèle d'origine, sérialisés (une List a des clés numériques :
  // key.startsWith lève alors une TypeError)
  if (isList(model)) {
    if (model.length > 0) throw typeError('key.startsWith');
    return out;
  }
  const serialised = Object.keys(model)
    .filter((key) => key.startsWith('axes') && axesToJsList.includes(key))
    .map((key) => {
      const item = model[key];
      return [key, JSON.stringify(item ? imToJS(item) : null)] as [string, string];
    });
  let merged = out as IMap;
  for (const [key, value] of serialised) merged = setKey(merged, key, value);
  return merged;
};

const PRE_SAVE: Partial<Record<SchemaName, (model: IMap | unknown[]) => unknown>> = {
  user: (model) => imUpdate(model, 'organisationSettings', [], (orgSettings) =>
    imMap(orgSettings, (orgSetting) => imUpdate(orgSetting, 'filter', mapFromEntries([]), stringifyIfNotEmpty))),
  visualisation: preSaveVisualisation,
  statementForwarding: (model) => imUpdate(model, 'query', fromJS({}), (query) => JSON.stringify(imToJS(query))),
  query: (model) => imUpdate(model, 'conditions', mapFromEntries([]), stringifyIfNotEmpty),
  client: (model) => imUpdate(model, 'authority', undefined, (authority) => (isMap(authority) ? JSON.stringify(toJS(authority)) : undefined)),
  dashboard: (model) => {
    if (!imGet(model, 'shareable', undefined)) return model;
    const shareable = imMap(imGet(model, 'shareable', []), (item) => imUpdate(item, 'filter', mapFromEntries([]), stringifyIfNotEmpty));
    return imSet(model, 'shareable', shareable);
  },
  export: (model) => imUpdate(model, 'projections', [], (projections) => imMap(projections, (condition) => JSON.stringify(imToJS(condition)))),
};

/**
 * preSave du schéma : modèle du front (JSON, comme Immutable.fromJS(props)) → corps envoyé à l'API.
 * Les champs JSON sont sérialisés en chaîne (filters, axes*, query, conditions, authority, filter des
 * partages, projections, organisationSettings[].filter). Lève les mêmes erreurs que l'original sur une
 * valeur mal typée.
 */
export const preSave = (schema: string, model: unknown): unknown => {
  if (!isSchemaName(schema)) throw new Error(`Schéma inconnu : ${schema}`);
  const internal = fromJS(model);
  const fn = PRE_SAVE[schema];
  if (!fn) return toJS(internal);
  if (!isMap(internal) && !isList(internal)) throw typeError('update');
  return toJS(fn(internal));
};

// --- reviver ---------------------------------------------------------------------------------------

/** Seq passée au reviver : enfants déjà ravivés, ordre d'origine. */
class Seq {
  constructor(readonly indexed: boolean, readonly entries: readonly (readonly [string, unknown])[]) {}

  toMap(): IMap { return mapFromEntries(this.entries); }
  toList(): unknown[] { return this.entries.map(([, value]) => value); }
  toSet(): ImmutableSet<unknown> { return new ImmutableSet(VALUE_OPS, this.toList()); }

  get(key: string, notSetValue?: unknown): unknown {
    if (this.indexed) {
      const index = listIndex(key);
      return index < this.entries.length ? this.entries[index]?.[1] : notSetValue;
    }
    const entry = this.entries.find(([k]) => k === key);
    return entry ? entry[1] : notSetValue;
  }

  has(key: string): boolean { return this.get(key, NOT_SET) !== NOT_SET; }

  /** La Seq elle-même dans le modèle (toJS : objet dans l'ordre d'origine, ou tableau). */
  asValue(): unknown {
    if (this.indexed) return this.toList();
    const out = Object.create(null) as IMap;
    for (const [key, value] of this.entries) out[key] = value;
    ORDERED_MAPS.add(out);
    return out;
  }
}

type Reviver = (key: string | number, value: Seq) => unknown;

const reviveWith = (json: unknown, reviver: Reviver, key: string | number = ''): unknown => {
  if (Array.isArray(json)) return reviver(key, new Seq(true, json.map((item: unknown, index) => [String(index), reviveWith(item, reviver, index)] as const)));
  if (json !== null && typeof json === 'object') {
    if (!isImmutablePlainObj(json)) {
      markRaw(json);
      return json;
    }
    const source = json as Record<string, unknown>;
    return reviver(key, new Seq(false, Object.keys(source).map((k) => [k, reviveWith(source[k], reviver, k)] as const)));
  }
  return json;
};

const defaultReviver: Reviver = (_key, value) => (value.indexed ? value.toList() : value.toMap());

// OrderedMap(valeur) : conversion superficielle (les valeurs objets restent des objets JS bruts).
const orderedMap = (value: unknown): IMap => {
  const out = Object.create(null) as IMap;
  ORDERED_MAPS.add(out);
  if (value === null || value === undefined) return out;
  const put = (key: unknown, item: unknown): void => {
    if (item !== null && typeof item === 'object') markRaw(item);
    out[String(key)] = item;
  };
  if (Array.isArray(value)) {
    // Tableau : entrées [clé, valeur].
    for (const entry of value as unknown[]) {
      if (entry !== Object(entry)) throw new TypeError(`Expected [K, V] tuple: ${String(entry)}`);
      put((entry as Record<number, unknown>)[0], (entry as Record<number, unknown>)[1]);
    }
    return out;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) put(key, (value as Record<string, unknown>)[key]);
    return out;
  }
  throw new TypeError(`Expected Array or iterable object of [k, v] entries, or keyed object: ${JSON.stringify(value)}`);
};

const withId: Reviver = (key, value) => {
  if (key) return value.toMap();
  return setKey(value.toMap(), '_id', value.get('_id') || value.get('id'));
};

const REVIVERS: Partial<Record<SchemaName, Reviver>> = {
  user: (key, value) => {
    if (key === 'organisationSettings') {
      return value.toList().map((orgSetting) => {
        const filterValue = imGet(orgSetting, 'filter', '{}');
        let parsedQuery: unknown;
        try {
          parsedQuery = parseLoose(filterValue);
        } catch {
          parsedQuery = {};
        }
        return imSet(orgSetting, 'filter', fromJS(parsedQuery));
      });
    }
    return defaultReviver(key, value);
  },
  statementForwarding: (_key, value) => {
    let out = value.toMap();
    const query = value.get('query');
    if (typeof query === 'string') out = setKey(out, 'query', fromJS(JSON.parse(query)));
    return out;
  },
  personaIdentifier: withId,
  personaAttribute: withId,
  dashboard: (key, value) => {
    if (value.has('filter')) {
      try {
        return setKey(value.toMap(), 'filter', fromJS(parseLoose(value.get('filter', '{}'))));
      } catch {
        return value.asValue();
      }
    }
    if (key === 'widgets') return value.toList();
    return defaultReviver(key, value);
  },
  export: (key, value) => {
    if (key === 'projections') {
      return value.toList().map((projection) => {
        let parsedProjection: unknown;
        try {
          parsedProjection = parseLoose(projection);
        } catch {
          parsedProjection = {};
        }
        return orderedMap(parsedProjection);
      });
    }
    return value.indexed ? value.toSet() : value.toMap();
  },
};

/**
 * reviver du schéma : document de l'API (champs JSON en chaîne) → modèle du front, en JSON.
 * Particularités d'origine reproduites, entre autres :
 * - export : tout tableau autre que projections devient un Set (doublons retirés, ordre de hachage) ;
 *   chaque projection est une OrderedMap superficielle ;
 * - statementForwarding : tout tableau devient un objet indexé ("0", "1"…) ;
 * - personaIdentifier/personaAttribute : la racine ET le premier élément de chaque tableau reçoivent
 *   `_id = _id || id` ;
 * - dashboard : un filtre de partage illisible laisse l'objet tel quel (ordre d'origine des clés).
 */
export const revive = (schema: string, document: unknown): unknown => {
  if (!isSchemaName(schema)) throw new Error(`Schéma inconnu : ${schema}`);
  if (schema === 'visualisation') return toJS(reviveVisualisationInternal(document));
  return toJS(reviveWith(document, REVIVERS[schema] ?? defaultReviver));
};

