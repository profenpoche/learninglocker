// Préparation côté serveur d'une requête ou d'un pipeline d'agrégation venant d'un client :
// `$oid` → ObjectId, `$dte` → Date, `statement.timestamp`/`statement.stored` → champs indexés,
// suppression de `$out`, filtrage des `$lookup`, résolution de `$personaIdent`.
// Code d'origine : legacy/lib/helpers/{parseQuery,convert$oid,convert$dte,convertStatementTimestamp,
// remove$out,filter$lookup,convert$personaIdent}.js et
// legacy/lib/services/auth/authInfoSelectors/{getOrgFromAuthInfo,getTokenTypeFromAuthInfo}.js.
//
// Les accès à la base sont injectés (QueryDependencies) : la bibliothèque ne dépend d'aucun driver.
// Le code d'origine modifie parfois ses entrées et dépend de la sémantique exacte de lodash : on la
// reproduit (lodash.ts) ; les écarts connus sont décrits fonction par fonction.

import { get, has, isPlainObject, mapValues, set, toConsumableArray } from './lodash.js';
import { defaultObjectIdFactory, toDate, toObjectId, type ObjectIdFactory } from './values.js';

/** Arguments passés à getScopeFilter (lib/services/auth/filters/getScopeFilter). */
export interface ScopeFilterRequest {
  modelName: unknown;
  actionName: 'view';
  authInfo: unknown;
  allowDashboardAccess: true;
}

/** Arguments passés à personaService.getAttributes (@learninglocker/persona-service). */
export interface PersonaAttributesRequest {
  filter: { key: unknown; value: unknown };
  organisation: unknown;
  limit: number;
  maxTimeMS: number;
}

export interface QueryDependencies {
  /** Filtre de droits d'un modèle (requête MongoDB, ObjectId compris). */
  getScopeFilter: (request: ScopeFilterRequest) => Promise<unknown>;
  /** Attributs de persona : `{ edges: [{ node: { personaId } }] }`, comme persona-service. */
  getPersonaAttributes: (request: PersonaAttributesRequest) => Promise<unknown>;
  /** Fabrique d'ObjectId (défaut : ObjectIdRef). */
  objectId?: ObjectIdFactory;
  /** Journalisation des erreurs de persona-service (défaut : rien). */
  logError?: (message: string, error: unknown) => void;
  /** MAX_TIME_MS du serveur (variable d'environnement, 0 par défaut). */
  maxTimeMS?: number;
}

// --- convert$oid / convert$dte ---------------------------------------------------------------------

/** Remplace chaque `{ $oid: … }` par un ObjectId ; une valeur invalide reste telle quelle. */
export const convert$oid = (value: unknown, factory: ObjectIdFactory = defaultObjectIdFactory): unknown => {
  if (has(value, '$oid')) {
    try {
      return toObjectId(get(value, '$oid'), factory);
    } catch {
      return get(value, '$oid');
    }
  } else if (Array.isArray(value)) {
    return value.map((item: unknown) => convert$oid(item, factory));
  } else if (isPlainObject(value)) {
    return mapValues(value, (item) => convert$oid(item, factory));
  }
  return value;
};

/** Remplace chaque `{ $dte: … }` par `new Date(…)` (Date invalide comprise). */
export const convert$dte = (value: unknown): unknown => {
  if (has(value, '$dte')) return toDate(get(value, '$dte'));
  else if (Array.isArray(value)) return value.map((item: unknown) => convert$dte(item));
  else if (isPlainObject(value)) return mapValues(value, (item) => convert$dte(item));
  return value;
};

// --- convertStatementTimestamp ---------------------------------------------------------------------

type Parser = (filter: Record<string, unknown>) => Record<string, unknown>;

const createFilterParser = (key: string, parser: Parser) => (filter: unknown): unknown => {
  if (Array.isArray(filter)) {
    return filter.map(createFilterParser(key, parser));
  }
  if (isPlainObject(filter)) {
    let newFilter = filter;
    if (has(newFilter, key)) {
      try {
        newFilter = parser(newFilter);
      } catch {
        newFilter = filter;
      }
    }
    return mapValues(newFilter, createFilterParser(key, parser));
  }
  return filter;
};

const convertToDate = (value: unknown): unknown => (typeof value === 'string' ? toDate(value) : value);
const identity = (value: unknown): unknown => value;

// Modifie le filtre : la nouvelle clé est ajoutée en fin d'objet (ou remplace une clé existante à sa
// place), l'ancienne supprimée. `has`/`get` suivent aussi le chemin imbriqué { statement: { timestamp } } :
// la valeur est alors copiée sous la nouvelle clé SANS supprimer l'original (comportement d'origine).
const dateParser = (mutator: (value: unknown) => unknown, oldKey: string, newKey: string): Parser => (filter) => {
  const newFilter = filter;
  const timestampValue = get(newFilter, oldKey);
  if (typeof timestampValue === 'string') {
    newFilter[newKey] = mutator(timestampValue);
  } else if (isPlainObject(timestampValue)) {
    newFilter[newKey] = mapValues(timestampValue, mutator);
  } else {
    newFilter[newKey] = timestampValue;
  }
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- suppression de la clé d'origine, comme le legacy
  delete newFilter[oldKey];
  return newFilter;
};

const createDateParser = (oldKey: string, newKey: string, mutator: (value: unknown) => unknown) =>
  createFilterParser(oldKey, dateParser(mutator, oldKey, newKey));

const convertMatch = (match: unknown): unknown => {
  const parsed = createDateParser('statement.timestamp', 'timestamp', convertToDate)(match);
  return createDateParser('statement.stored', 'stored', convertToDate)(parsed);
};

const convertSort = (sort: unknown): unknown => {
  const parsed = createDateParser('statement.timestamp', 'timestamp', identity)(sort);
  return createDateParser('statement.stored', 'stored', identity)(parsed);
};

const convertPipeline = (pipeline: unknown[]): unknown[] => pipeline.map((stage: unknown) => {
  if (has(stage, '$match')) {
    // `{ ...stage, $match }` transpilé : Object.assign (voir lodash.ts).
    return Object.assign({}, stage, { $match: convertMatch(get(stage, '$match')) });
  }
  if (has(stage, '$sort')) {
    return Object.assign({}, stage, { $sort: convertSort(get(stage, '$sort')) });
  }
  return stage;
});

/**
 * `statement.timestamp` → `timestamp` et `statement.stored` → `stored` (champs indexés), dans les
 * `$match` et `$sort` d'un pipeline, ou dans un filtre ; les chaînes deviennent des dates dans un `$match`.
 */
export const convertStatementTimestamp = (value: unknown): unknown => {
  if (Array.isArray(value)) return convertPipeline(value);
  if (isPlainObject(value)) return convertMatch(value);
  return value;
};

// --- remove$out ----------------------------------------------------------------------------------

const shouldRemoveOut = (value: unknown): boolean => isPlainObject(value) && has(value, '$out');

/**
 * Retire les étapes `$out` des tableaux, à toute profondeur. Dans un objet, l'original filtre les CLÉS
 * (des chaînes) avec le même prédicat : rien n'y est jamais retiré (reproduit).
 */
export const remove$out = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.filter((item: unknown) => !shouldRemoveOut(item)).map((item: unknown) => remove$out(item));
  }
  if (isPlainObject(value)) {
    return mapValues(value, (item) => remove$out(item));
  }
  return value;
};

// --- filter$lookup ---------------------------------------------------------------------------------

const ALLOWED_COLLECTIONS = ['personas', 'personaIdentifiers', 'personaAttributes', 'journeys', 'journeyprogresses', 'statements'];

// Lu par COLLECTIONS_TO_MODELS[collection] : une clé héritée (« constructor »…) y renvoie sa valeur héritée.
const COLLECTIONS_TO_MODELS: Record<string, unknown> = {
  personas: 'persona',
  personaIdentifiers: 'personaidentifier',
  personaAttributes: 'personaattribute',
  journeys: 'journey',
  journeyprogresses: 'journeyprogress',
  statements: 'statement',
};

const shouldRemoveLookup = (stage: unknown): boolean => has(stage, ['$lookup', 'from']) && !ALLOWED_COLLECTIONS.includes(get(stage, ['$lookup', 'from']) as string);

const filterStage = async (stage: Record<string, unknown>, authInfo: unknown, getScopeFilter: QueryDependencies['getScopeFilter']): Promise<Record<string, unknown>> => {
  if (!has(stage, '$lookup')) return stage;
  if (!authInfo) return stage;

  const collection = get(stage, ['$lookup', 'from']);
  const scopedFilter = await getScopeFilter({
    modelName: COLLECTIONS_TO_MODELS[String(collection)],
    actionName: 'view',
    authInfo,
    allowDashboardAccess: true,
  });
  const existingPipeline = get(stage, ['$lookup', 'pipeline'], []);
  // `[...existingPipeline]` transpilé : Array.from pour un non-tableau (objet → [], chaîne → caractères).
  const newPipeline = [{ $match: scopedFilter }, ...toConsumableArray(existingPipeline)];
  return set(stage, ['$lookup', 'pipeline'], newPipeline) as Record<string, unknown>;
};

/**
 * Retire des tableaux les `$lookup` vers une collection non autorisée et, avec un authInfo, préfixe le
 * pipeline de chaque `$lookup` par `{ $match: <filtre de droits> }`. Modifie les étapes `$lookup`.
 */
export const filter$lookup = async (pipeline: unknown, authInfo: unknown, getScopeFilter: QueryDependencies['getScopeFilter']): Promise<unknown> => {
  if (Array.isArray(pipeline)) {
    const kept = pipeline.filter((stage: unknown) => !shouldRemoveLookup(stage));
    return Promise.all(kept.map((stage: unknown) => filter$lookup(stage, authInfo, getScopeFilter)));
  }
  if (isPlainObject(pipeline)) {
    const filtered = await filterStage(pipeline, authInfo, getScopeFilter);
    return Object.keys(filtered).reduce<Promise<Record<string, unknown>>>(async (reduction, key) => {
      const stage = filtered[key];
      // `{ ...acc, [key]: v }` transpilé : Object.assign (une clé « __proto__ » y devient le prototype,
      // puis disparaît à la clé suivante).
      const accumulated = await reduction;
      return Object.assign({}, accumulated, { [key]: await filter$lookup(stage, authInfo, getScopeFilter) });
    }, Promise.resolve({}));
  }
  return pipeline;
};

// --- convert$personaIdent --------------------------------------------------------------------------

/** Organisation de l'authentification (getOrgFromAuthInfo). */
export const getOrgFromAuthInfo = (authInfo: unknown): unknown => {
  const tokenId = get(authInfo, ['token', 'tokenId']);
  const tokenType = get(authInfo, ['token', 'tokenType']);
  if (tokenType === 'organisation' || tokenType === 'worker') return tokenId;
  const tokenOrgId = get(authInfo, ['token', 'organisationId']);
  if (tokenOrgId) return tokenOrgId;
  const clientOrgId = get(authInfo, ['client', 'organisation']);
  if (clientOrgId) return clientOrgId;
  const dashboardOrgId = get(authInfo, ['token', 'organisation']);
  if (dashboardOrgId) return dashboardOrgId;
  return null;
};

const convertOpValue = async (identifier: unknown, options: unknown, deps: QueryDependencies): Promise<unknown> => {
  // Paramètre d'origine `{ authInfo } = {}` : défaut pour undefined seulement (null lève une TypeError).
  const { authInfo } = (options === undefined ? {} : options) as { authInfo?: unknown };
  const organisation = getOrgFromAuthInfo(authInfo);
  // Comme l'original : TypeError si identifier ou identifier.key ne s'y prêtent pas.
  const source = identifier as { key: { replace: (pattern: string, replacement: string) => unknown }; value: unknown };
  const filter = { key: source.key.replace('persona.import.', ''), value: source.value };

  let attributes: unknown[];
  try {
    const result = await deps.getPersonaAttributes({ filter, organisation, limit: Number.MAX_SAFE_INTEGER, maxTimeMS: deps.maxTimeMS ?? 0 });
    const edges = (result as { edges: unknown }).edges;
    attributes = Array.isArray(edges) ? edges.map((edge: unknown) => (edge as { node: unknown }).node) : lodashMapObject(edges, (edge) => (edge as { node: unknown }).node);
  } catch (err) {
    deps.logError?.('convert$personaIdent', err);
    return undefined;
  }

  const ids = attributes.map((attribute) => (attribute as { personaId: unknown }).personaId);
  return { $in: ids.filter((id) => id !== undefined && id !== null) };
};

// _.map sur une valeur non tableau : valeurs d'un objet, [] sinon.
const lodashMapObject = (value: unknown, iteratee: (item: unknown) => unknown): unknown[] =>
  value !== null && typeof value === 'object' ? Object.keys(value).map((key) => iteratee((value as Record<string, unknown>)[key])) : [];

/**
 * Remplace chaque `{ $personaIdent: { key: 'persona.import.<attr>', value } }` par
 * `{ $in: [ids des personas ayant cet attribut] }` (undefined si persona-service échoue).
 * Le résultat est reconstruit par Object.assign : une clé « __proto__ » y change le prototype.
 */
export const convert$personaIdent = (value: unknown, options: unknown, deps: QueryDependencies): Promise<unknown> => {
  if (has(value, '$personaIdent')) {
    return convertOpValue(get(value, '$personaIdent'), options, deps);
  } else if (Array.isArray(value)) {
    return Promise.all(value.map((item: unknown) => convert$personaIdent(item, options, deps)));
  } else if (isPlainObject(value)) {
    return Promise.all(Object.keys(value).map((key) =>
      convert$personaIdent(value[key], options, deps).then((converted) => ({ [key]: converted })),
    )).then((parts) => Object.assign({}, ...parts) as unknown);
  }
  return Promise.resolve(value);
};

// --- parseQuery ------------------------------------------------------------------------------------

const prepare = (pipeline: unknown, factory: ObjectIdFactory): unknown => {
  let parsed: unknown = typeof pipeline === 'string' ? JSON.parse(pipeline) : pipeline;
  parsed = convert$oid(parsed, factory);
  parsed = convert$dte(parsed);
  parsed = convertStatementTimestamp(parsed);
  parsed = remove$out(parsed);
  return parsed;
};

/**
 * Prépare une requête (filtre) ou un pipeline d'agrégation reçu d'un client, chaîne JSON ou valeur.
 *
 * **Comme l'original, la promesse est résolue avec l'erreur en cas d'échec** (`.catch(err => err)`) :
 * JSON invalide, `options` absent, `$personaIdent` mal formé, erreur de getScopeFilter… Voir
 * parseQueryOrThrow pour une variante qui rejette.
 *
 * @param options `{ authInfo }` de la requête HTTP.
 */
export const parseQuery = (pipeline: unknown, options: unknown, deps: QueryDependencies): Promise<unknown> =>
  Promise.resolve()
    .then(() => prepare(pipeline, deps.objectId ?? defaultObjectIdFactory))
    .then(async (parsed) => {
      const filtered = await filter$lookup(parsed, (options as { authInfo?: unknown }).authInfo, deps.getScopeFilter);
      return convert$personaIdent(filtered, options, deps);
    })
    .catch((err: unknown) => err);

/** parseQuery, mais la promesse est rejetée en cas d'échec. */
export const parseQueryOrThrow = async (pipeline: unknown, options: unknown, deps: QueryDependencies): Promise<unknown> => {
  const parsed = prepare(pipeline, deps.objectId ?? defaultObjectIdFactory);
  const filtered = await filter$lookup(parsed, (options as { authInfo?: unknown }).authInfo, deps.getScopeFilter);
  return convert$personaIdent(filtered, options, deps);
};

