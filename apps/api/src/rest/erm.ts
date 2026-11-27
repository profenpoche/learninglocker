// Lecture REST générique compatible express-restify-mongoose 3.2.1 (erm), avec les options de
// l'API legacy (RESTIFY_DEFAULTS : lean false, contextFilter, onError, preRead parseQuery).
// Codes d'origine : node_modules/express-restify-mongoose@3.2.1/lib/{middleware/prepareQuery,buildQuery,
// operations,errorHandler,resource_filter}.js, legacy/lib/constants/auth.js (RESTIFY_DEFAULTS,
// contextFilter), mongoose@5.8.1 lib/{query,utils}.js (merge des conditions et des projections).
//
// Renforcement de sécurité (D7) : la fusion des conditions (comportement « overwrite » de Mongoose 5)
// ne doit pas laisser une clé fournie par le client remplacer un filtre de droits. Les opérateurs
// logiques sont donc concaténés ; tout le reste est fusionné comme avant.
import { parseJsonLegacy } from '../http/legacy-json.js';

/** Erreur au format erm (`statusCode`, `description`), renvoyée par onError avec ses propriétés propres. */
export class ErmError extends Error {
  statusCode: number;
  description?: string;
  constructor(message: string, statusCode: number, description?: string) {
    super(message);
    this.statusCode = statusCode;
    if (description !== undefined) this.description = description;
  }
}

export interface ErmQueryOptions {
  distinct?: unknown;
  limit?: number;
  populate?: unknown;
  query?: unknown;
  select?: unknown;
  skip?: number;
  sort?: unknown;
}

/** is-coordinates 1.0 (sans option validate) : tableau de deux nombres. */
const isCoordinates = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';

/** jsonQueryParser d'erm (allowRegex true) : raccourcis ~, >, >=, <, <=, != et tableaux → $in. */
function jsonQueryParser(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('~')) return new RegExp(value.substring(1), 'i');
    if (value.startsWith('>')) return value[1] === '=' ? { $gte: value.substring(2) } : { $gt: value.substring(1) };
    if (value.startsWith('<')) return value[1] === '=' ? { $lte: value.substring(2) } : { $lt: value.substring(1) };
    if (value.startsWith('!') && value[1] === '=') return { $ne: value.substring(2) };
  } else if (Array.isArray(value) && !key.startsWith('$') && key !== 'coordinates' && !isCoordinates(value)) {
    return { $in: value };
  }
  return value;
}

const parseQueryOptions = (options: ErmQueryOptions): ErmQueryOptions => {
  if (options.select && typeof options.select === 'string') {
    const select: Record<string, number> = {};
    for (const field of options.select.split(',')) {
      if (field.startsWith('-')) select[field.substring(1)] = 0;
      else select[field] = 1;
    }
    options.select = select;
  }
  if (options.populate) {
    if (typeof options.populate === 'string') {
      const paths = options.populate.split(',');
      const populate: { path: string; select?: string }[] = [];
      paths.forEach((path, i) => {
        populate.push({ path });
        const select = options.select as Record<string, number> | undefined;
        for (const key in select) {
          if (key.indexOf(`${path}.`) === 0) {
            const entry = populate[i] as { path: string; select?: string };
            entry.select = entry.select === undefined ? '' : `${entry.select} `;
            if (select[key] === 0) entry.select += '-';
            entry.select += key.substring(path.length + 1);
            Reflect.deleteProperty(select, key);
          }
        }
        if (select) {
          if (Object.keys(select).length > 0 && !select[path]) select[path] = 1;
          else if (Object.keys(select).length === 0) delete options.select;
        }
      });
      options.populate = populate;
    } else if (!Array.isArray(options.populate)) {
      options.populate = [options.populate];
    }
  }
  return options;
};

/** prepareQuery d'erm : options lues dans la query string (liste blanche), ou ErmError 400. */
export const prepareQuery = (query: Record<string, unknown>): ErmQueryOptions => {
  const whitelist = ['distinct', 'limit', 'populate', 'query', 'select', 'skip', 'sort'];
  const options: Record<string, unknown> = {};
  for (const key in query) {
    if (!whitelist.includes(key)) continue;
    const value = query[key];
    if (key === 'query') {
      try {
        options[key] = parseJsonLegacy(value, function reviver(this: unknown, k: string, v: unknown) { return jsonQueryParser(k, v); });
      } catch {
        throw new ErmError('%s must be a valid JSON string', 400, 'invalid_json');
      }
    } else if (key === 'populate' || key === 'select' || key === 'sort') {
      try {
        options[key] = JSON.parse(String(value));
      } catch {
        options[key] = value;
      }
    } else if (key === 'limit' || key === 'skip') {
      options[key] = Number.parseInt(String(value), 10);
    } else {
      options[key] = value;
    }
  }
  return parseQueryOptions(options);
};

// --- fusion des conditions et des projections (Mongoose 5.8) ---------------------------------------

const SPECIAL = new Set(['__proto__', 'constructor', 'prototype']);
const isObject = (value: unknown): value is Record<string, unknown> =>
  Buffer.isBuffer(value) || Object.prototype.toString.call(value) === '[object Object]';

/**
 * Query.prototype.merge (overwrite) de Mongoose 5.8, sauf pour les opérateurs logiques déjà présents
 * (`$and`, `$or`, `$nor`) : concaténés dans un `$and`, pour qu'aucune clé fournie par le client ne
 * remplace un filtre de droits (renforcement D7).
 */
export const mergeConditions = (to: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> => {
  for (const key of Object.keys(from)) {
    if (SPECIAL.has(key)) continue;
    const value = from[key];
    if (to[key] === null || to[key] === undefined) {
      to[key] = value;
    } else if (key === '$and' && Array.isArray(to[key]) && Array.isArray(value)) {
      to[key] = [...(to[key] as unknown[]), ...(value as unknown[])];
    } else if ((key === '$or' || key === '$nor') && Array.isArray(to[key])) {
      const existing = { [key]: to[key] };
      Reflect.deleteProperty(to, key);
      to.$and = [...(Array.isArray(to.$and) ? to.$and as unknown[] : []), existing, { [key]: value }];
    } else if (isObject(value)) {
      if (!isObject(to[key])) to[key] = {};
      mergeConditions(to[key] as Record<string, unknown>, value);
    } else {
      to[key] = value;
    }
  }
  return to;
};

/** Query.prototype.select de Mongoose 5.8 : ajoute les champs (chaîne « a -b », tableau ou objet). */
export const mergeSelect = (fields: Record<string, unknown>, arg: unknown): Record<string, unknown> => {
  if (!arg) return fields;
  if (typeof arg === 'string' || Array.isArray(arg)) {
    const list = typeof arg === 'string' ? arg.split(/\s+/) : arg as unknown[];
    for (const field of list) {
      if (!field) continue;
      let name = typeof field === 'string' ? field : JSON.stringify(field);
      const include = name.startsWith('-') ? 0 : 1;
      if (include === 0) name = name.substring(1);
      fields[name] = include;
    }
    return fields;
  }
  if (isObject(arg)) {
    for (const key of Object.keys(arg)) fields[key] = arg[key];
    return fields;
  }
  throw new TypeError('Invalid select() argument. Must be string or object.');
};

// --- erreurs de requête (errorHandler d'erm et CastError de Mongoose 5.8) --------------------------

const BSON_MESSAGE = 'Argument passed in must be a single String of 12 bytes or a string of 24 hex characters';

/** Rendu JSON d'une CastError au format de Mongoose 5.8 (sans pile d'appel). */
export const legacyCastError = (error: { kind?: unknown; value?: unknown; path?: unknown }, modelName: string, statusCode: number): Record<string, unknown> => {
  const { kind, value, path } = error;
  const inspected = typeof value === 'string' ? `"${value}"` : `"${JSON.stringify(value)}"`;
  return {
    stringValue: inspected,
    kind,
    value,
    path,
    ...(kind === 'ObjectId' ? { reason: { message: BSON_MESSAGE } } : {}),
    message: `Cast to ${String(kind)} failed for value ${inspected} at path "${String(path)}" for model "${modelName}"`,
    name: 'CastError',
    statusCode,
  };
};
