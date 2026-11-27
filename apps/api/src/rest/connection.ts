// Pagination « connection » (Relay) et comptage des modèles : curseurs identiques au legacy.
// Codes d'origine : legacy/lib/models/plugins/addCRUDFunctions.js (getConnection, getCount),
// legacy/lib/helpers/cursor.js, legacy/lib/models/statement.js (postFetchMap : décodage `&46;`).
import { mapDot } from '@ll/shared';
import type { AuthInfo } from '../auth/auth-info.js';
import type { LegacyModel } from '../db/models.js';
import { getScopeSelect } from '../scopes/scope-filter.js';
import type { ScopeService } from '../scopes/scope.service.js';
import { mergeConditions } from './erm.js';

const BACKWARDS = 'backwards';
const FORWARDS = 'forwards';

/** cursor.js : base64 de JSON.stringify (encodage « ascii » de Buffer, comme `new Buffer(i, 'ascii')`). */
export const toCursor = (data: unknown): string => Buffer.from(JSON.stringify(data), 'ascii').toString('base64');

export const fromCursor = (cursor: unknown): unknown => {
  if (cursor) {
    try {
      return (JSON.parse(Buffer.from(cursor as string, 'base64').toString('ascii')) as unknown) || null;
    } catch {
      return null;
    }
  }
  return null;
};

const sortDirectionToOperator = (direction: unknown, paginationDirection: string): string | null => {
  const ascending = direction === 1 || direction === 'asc';
  const descending = direction === -1 || direction === 'desc';
  if (!ascending && !descending) return null;
  if (paginationDirection === FORWARDS) return ascending ? '$gt' : '$lt';
  return ascending ? '$lt' : '$gt';
};

/** paginationToFilter : `$or` lexicographique sur les clés de tri. Curseur invalide → TypeError (message de Node 10). */
const paginationToFilter = (cursor: unknown, sort: Record<string, unknown>, paginationDirection: string): Record<string, unknown> => {
  const parsedCursor = fromCursor(cursor) as Record<string, unknown> | null;
  const read = (key: string): unknown => {
    if (parsedCursor === null) throw new TypeError(`Cannot read property '${key}' of null`);
    return parsedCursor[key];
  };
  const oldKeys: string[] = [];
  const conditions: Record<string, unknown>[] = [];
  for (const [key, direction] of Object.entries(sort)) {
    const operator = sortDirectionToOperator(direction, paginationDirection);
    const latestCondition = { [key]: { [String(operator)]: read(key) } };
    const oldConditions = Object.fromEntries(oldKeys.map((oldKey) => [oldKey, read(oldKey)]));
    conditions.push({ ...oldConditions, ...latestCondition });
    oldKeys.push(key);
  }
  return { $or: conditions };
};

// lodash : castPath (clé simple si la chaîne entière est une propriété), hasIn, pick.
const castPath = (key: string, object: object): string[] => (key in object ? [key] : key.split('.'));
const hasIn = (object: unknown, path: string[]): boolean => {
  let current: unknown = object;
  for (const segment of path) {
    if (current === null || current === undefined || !(segment in Object(current))) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
};

/** `_.pick(document, keys(sort))` : lu par les accesseurs du document Mongoose. */
export const pickForCursor = (model: unknown, sort: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  if (model === null || model === undefined) return result;
  for (const key of Object.keys(sort)) {
    const path = castPath(key, model);
    if (!hasIn(model, path)) continue;
    let value: unknown = model;
    for (const segment of path) value = (value as Record<string, unknown>)[segment];
    let target = result;
    path.forEach((segment, i) => {
      if (i === path.length - 1) {
        target[segment] = value;
      } else {
        if (typeof target[segment] !== 'object' || target[segment] === null) target[segment] = {};
        target = target[segment] as Record<string, unknown>;
      }
    });
  }
  return result;
};

const modelToCursor = (model: unknown, sort: Record<string, unknown>): string => toCursor(pickForCursor(model, sort));

/** _.isEmpty */
const isEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return true;
};

/** getParsedScopedFilter : filtre du client (parseQuery) et filtre de droits, réunis par `$and`. */
export const getParsedScopedFilter = async (
  scopes: ScopeService,
  { authInfo, filter, modelName, actionName }: { authInfo: AuthInfo; filter: unknown; modelName: string; actionName: string },
): Promise<unknown> => {
  const parsedFilter = await scopes.parseQuery(filter, authInfo);
  const scopedFilter = await scopes.getScopeFilter({ modelName, actionName, authInfo });
  const filters = [parsedFilter, scopedFilter].filter((item) => item !== undefined && !isEmpty(item));
  return filters.length <= 1 ? filters[0] : { $and: filters };
};

/** Statement.postFetchMap : clés `&46;` du statement décodées en `.`. */
const postFetchMap = (modelName: string, doc: { get(path: string): unknown; set(path: string, value: unknown): unknown }) => {
  if (modelName !== 'Statement') return doc;
  const statement = doc.get('statement');
  if (statement !== undefined) doc.set('statement', mapDot(statement));
  return doc;
};

export interface ConnectionArgs {
  authInfo: AuthInfo;
  filter?: unknown;
  sort?: unknown;
  first?: number;
  last?: number;
  after?: unknown;
  before?: unknown;
  hint?: unknown;
  project?: unknown;
  maxTimeMS: number;
}

export const getConnection = async (scopes: ScopeService, model: LegacyModel, args: ConnectionArgs) => {
  const { authInfo, after, before, hint, project, maxTimeMS } = args;
  const first = args.first === undefined ? 10 : args.first;
  const sort = (args.sort === undefined ? { _id: 1 } : args.sort) as Record<string, unknown>;
  const filter = args.filter === undefined ? {} : args.filter;
  const { modelName } = model;
  const parsedScopeFilter = await getParsedScopedFilter(scopes, { authInfo, filter, modelName, actionName: 'view' });

  const direction = before ? BACKWARDS : FORWARDS;
  let conditions = parsedScopeFilter === undefined ? {} : { ...(parsedScopeFilter as Record<string, unknown>) };
  if (after) conditions = mergeConditions(conditions, paginationToFilter(after, sort, direction));
  else if (before) conditions = mergeConditions(conditions, paginationToFilter(before, sort, direction));

  const limit = first || args.last || 100;
  const scopeSelect = getScopeSelect({ modelName, authInfo });
  let projection: Record<string, unknown> | undefined;
  if (project) {
    if (scopeSelect) {
      const projectKeys = Object.keys(project);
      projection = Object.keys(scopeSelect).filter((key) => projectKeys.includes(key))
        .reduce<Record<string, unknown>>((result, key) => { result[key] = (project as Record<string, unknown>)[key]; return result; }, {});
    } else {
      projection = project as Record<string, unknown>;
    }
  } else {
    projection = scopeSelect;
  }

  const query = model.find(conditions, null, { maxTimeMS });
  query.sort(sort as Record<string, 1 | -1>);
  if (hint) query.hint(hint);
  query.limit(limit + 1);
  if (projection) query.select(projection as Record<string, number>);
  const models = await query.exec();
  const toReturn = models.slice(0, limit).map((doc) => postFetchMap(modelName, doc));

  const cursor = after || before;
  const out = {
    edges: toReturn.map((node) => ({ cursor: modelToCursor(node, sort), node })),
    pageInfo: {
      hasNextPage: (direction === BACKWARDS && cursor !== undefined) || (direction === FORWARDS && models.length > limit),
      hasPreviousPage: (direction === FORWARDS && cursor !== undefined) || (direction === BACKWARDS && models.length > limit),
      startCursor: modelToCursor(toReturn[0], sort),
      endCursor: modelToCursor(toReturn[toReturn.length - 1], sort),
    },
  };
  return out;
};

/** getCount (addCRUDFunctions) : raccourci par le compteur des stores pour les statements sans filtre. */
export const getCount = async (
  scopes: ScopeService,
  models: { model: LegacyModel; lrs: LegacyModel },
  { filter, authInfo, maxTimeMS, hint }: { filter: unknown; authInfo: AuthInfo; maxTimeMS: number; hint?: unknown },
): Promise<number> => {
  const { model, lrs } = models;
  const parsedScopeFilter = await getParsedScopedFilter(scopes, { authInfo, filter, modelName: model.modelName, actionName: 'view' });
  const keys = Object.keys(parsedScopeFilter as object);
  if (model.modelName === 'Statement' && isEmpty(filter) && keys.length === 1 && keys.includes('organisation')) {
    const cursor = lrs.collection.find(parsedScopeFilter as Record<string, unknown>, { projection: { statementCount: 1 } });
    if (hint) cursor.hint(hint);
    const docs = await cursor.toArray();
    return docs.reduce<number>((count, doc) => count + (doc.statementCount as number), 0);
  }
  const query = model.countDocuments(parsedScopeFilter as object).setOptions({ maxTimeMS });
  if (hint) query.hint(hint);
  return query.exec();
};
