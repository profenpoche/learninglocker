// Lectures REST génériques (`GET /v2/<modèle>`, `/count`, `/:id`), pagination `GET /connection/<modèle>`
// et index `GET /indexes/<modèle>`. Les écritures (POST, PUT, PATCH, DELETE) et `/:id/shallow` ne sont pas
// portées : elles passent à la route suivante (relais vers l'API legacy, ou 404).
// Codes d'origine : legacy/api/src/routes/HttpRoutes.js (restify.serve, generatedRouteModels),
// legacy/lib/constants/auth.js (RESTIFY_DEFAULTS), legacy/api/src/controllers/{ConnectionController,
// IndexesController}.js, legacy/api/src/utils/{getFromQuery,getJSONFromQuery,responses}.js,
// node_modules/express-restify-mongoose@3.2.1 (voir erm.ts).
//
// `/v2/<modèle>/:id/shallow` ne répond jamais dans le legacy (exception non rattrapée dans erm) :
// la route n'est pas portée ; le relais reproduit ce comportement, sans relais c'est un 404.
import { Controller, Get, Inject, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import mongoose from 'mongoose';
import { getAuthFromRequest, type AuthenticatedRequest, type AuthInfo } from '../auth/auth-info.js';
import { authenticateOr401 } from '../auth/passport.js';
import type { Strategies } from '../auth/strategies.js';
import { STRATEGIES } from '../auth/tokens.js';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { MODELS } from '../db/db.module.js';
import type { LegacyModel, ModelName, Models } from '../db/models.js';
import { errorToJson, parseJsonLegacy } from '../http/legacy-json.js';
import { parseBody } from '../http/body.js';
import { catchErrors, handleRequestError } from '../http/request-errors.js';
import { getScopeSelect } from '../scopes/scope-filter.js';
import { SCOPES } from '../scopes/scope.module.js';
import type { ScopeService } from '../scopes/scope.service.js';
import { getConnection } from './connection.js';
import { ErmError, legacyCastError, mergeConditions, mergeSelect, prepareQuery, type ErmQueryOptions } from './erm.js';

/** Modèles servis par restify.serve (URI `/v2/<nom du modèle>`, insensible à la casse). */
const ERM_MODELS: readonly ModelName[] = [
  'Organisation', 'Stream', 'Export', 'Download', 'Query', 'ImportCsv', 'User', 'Client', 'Visualisation', 'Dashboard',
  'Lrs', 'Statement', 'StatementForwarding', 'QueryBuilderCache', 'QueryBuilderCacheValue', 'Role', 'PersonaAttribute',
  'PersonasImport', 'PersonasImportTemplate', 'SiteSettings', 'BatchDelete',
];

/** generatedRouteModels : routes `/connection/<modèle>` et `/indexes/<modèle>`. */
const GENERATED_ROUTE_MODELS: readonly ModelName[] = [
  'Organisation', 'User', 'Statement', 'StatementForwarding', 'Lrs', 'QueryBuilderCache', 'QueryBuilderCacheValue',
  'Client', 'Dashboard', 'Visualisation', 'Query', 'Export', 'Download', 'ImportCsv', 'Role', 'PersonaAttribute',
  'PersonasImport', 'PersonasImportTemplate', 'BatchDelete',
];

const byLowerName = (names: readonly ModelName[]) => new Map(names.map((name) => [name.toLowerCase(), name]));
const ERM_BY_NAME = byLowerName(ERM_MODELS);
const GENERATED_BY_NAME = byLowerName(GENERATED_ROUTE_MODELS);

type ToObject = { toObject(): unknown };

/** Mongoose 5 ignorait un chemin à peupler absent du schéma ; Mongoose 9 lève une erreur sauf avec strictPopulate: false. */
const populateOptions = (populate: unknown): mongoose.PopulateOptions[] =>
  (populate as unknown[]).map((entry) => (typeof entry === 'object' && entry !== null
    ? { ...(entry as mongoose.PopulateOptions), strictPopulate: false }
    : { path: String(entry), strictPopulate: false }));

/** `_.hasIn(req, ['query', key]) ? modifier(valeur) : défaut` */
const fromQuery = <T>(req: AuthenticatedRequest, key: string, defaultValue: T, modifier: (value: unknown) => T): T => {
  const query = req.query as Record<string, unknown>;
  return key in query ? modifier(query[key]) : defaultValue;
};
const jsonFromQuery = (req: AuthenticatedRequest, key: string, defaultValue: unknown): unknown =>
  fromQuery(req, key, defaultValue, (value) => parseJsonLegacy(value));

interface ReadContext {
  authInfo: AuthInfo;
  scopeFilter: unknown;
  scopeSelect: Record<string, 1> | undefined;
}

@Controller()
export class RestController {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(MODELS) private readonly models: Models,
    @Inject(STRATEGIES) private readonly strategies: Strategies,
    @Inject(SCOPES) private readonly scopes: ScopeService,
  ) {}

  /** onError de RESTIFY_DEFAULTS : statut de l'erreur, corps = l'erreur elle-même. */
  private ermError(res: Response, error: unknown, model?: LegacyModel, statusCode?: number): void {
    this.logger.error('lib/constants/auth:', (error as { message?: unknown } | null)?.message);
    if (error instanceof mongoose.Error.CastError && model) {
      res.status(statusCode ?? 400).send(legacyCastError(error, model.modelName, statusCode ?? 400));
      return;
    }
    const status = statusCode ?? (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') {
      res.status(status);
      if (error instanceof Error) Object.assign(error, { statusCode: status });
    }
    res.send(errorToJson(error));
  }

  /** errorHandler d'erm : 404 pour un `_id` invalide de l'URL, 400 sinon. */
  private queryError(res: Response, error: unknown, model: LegacyModel, hasId: boolean): void {
    const castOnId = hasId && (error as { path?: unknown }).path === '_id' && (error as { name?: unknown }).name === 'CastError';
    this.ermError(res, error, model, castOnId ? 404 : 400);
  }

  /** prepareQuery, puis preMiddleware (authentification, filtre et sélection de droits), puis preRead (parseQuery). */
  private async prepare(req: AuthenticatedRequest, res: Response, model: LegacyModel): Promise<{ options: ErmQueryOptions; context: ReadContext } | null> {
    let options: ErmQueryOptions;
    try {
      options = prepareQuery(req.query);
    } catch (error) {
      this.ermError(res, error);
      return null;
    }
    const user = await authenticateOr401(this.strategies, ['jwt', 'clientBasic'], req, res);
    if (!user) return null;
    const authInfo = getAuthFromRequest(req);
    let context: ReadContext;
    try {
      const modelName = model.modelName.toLowerCase();
      const [scopeFilter, scopeSelect] = await Promise.all([
        this.scopes.getScopeFilter({ modelName, actionName: 'view', authInfo }),
        Promise.resolve().then(() => getScopeSelect({ modelName, authInfo })),
      ]);
      context = { authInfo, scopeFilter, scopeSelect };
    } catch (error) {
      handleRequestError(res, error, this.logger, this.config.log.level);
      return null;
    }
    if (options.query) options.query = await this.scopes.parseQuery(options.query, authInfo);
    return { options, context };
  }

  /** contextFilter + buildQuery : conditions et projection. */
  private conditions(context: ReadContext, options: ErmQueryOptions, extra?: Record<string, unknown>): Record<string, unknown> {
    const conditions: Record<string, unknown> = { $and: [context.scopeFilter, ...(extra ? [extra] : [])] };
    const userQuery = options.query;
    if (userQuery && typeof userQuery === 'object' && !Array.isArray(userQuery)) mergeConditions(conditions, userQuery as Record<string, unknown>);
    return conditions;
  }

  private projection(context: ReadContext, options: ErmQueryOptions): Record<string, unknown> | undefined {
    const fields = mergeSelect({}, context.scopeSelect);
    if (options.select) mergeSelect(fields, options.select);
    return Object.keys(fields).length ? fields : undefined;
  }

  private ermModel(name: string): LegacyModel | undefined {
    const modelName = ERM_BY_NAME.get(name.toLowerCase());
    return modelName ? this.models[modelName] : undefined;
  }

  @Get('v2/:model')
  async list(@Req() req: AuthenticatedRequest, @Res() res: Response, @Next() next: NextFunction): Promise<void> {
    const model = this.ermModel(String(req.params.model));
    if (!model) { next(); return; }
    await parseBody(req, res);
    const prepared = await this.prepare(req, res, model);
    if (!prepared) return;
    const { options, context } = prepared;
    try {
      const conditions = this.conditions(context, options);
      if (options.distinct) {
        const values = await model.distinct(options.distinct as string, conditions).exec();
        res.status(200).json(values);
        return;
      }
      const query = model.find(conditions);
      const projection = this.projection(context, options);
      if (projection) query.select(projection as Record<string, number>);
      if (options.skip) query.skip(options.skip);
      if (options.limit) query.limit(options.limit);
      if (options.sort) query.sort(options.sort as string);
      if (options.populate) query.populate(populateOptions(options.populate));
      const items = await query.exec();
      res.status(200).json(items.map((item) => (item as unknown as ToObject).toObject()));
    } catch (error) {
      this.queryError(res, error, model, false);
    }
  }

  @Get('v2/:model/count')
  async count(@Req() req: AuthenticatedRequest, @Res() res: Response, @Next() next: NextFunction): Promise<void> {
    const model = this.ermModel(String(req.params.model));
    if (!model) { next(); return; }
    await parseBody(req, res);
    const prepared = await this.prepare(req, res, model);
    if (!prepared) return;
    const { options, context } = prepared;
    try {
      const conditions = this.conditions(context, options);
      // Query.distinct() transformait le comptage en distinct (comportement d'erm reproduit).
      const count = options.distinct
        ? await model.distinct(options.distinct as string, conditions).exec()
        : await model.countDocuments(conditions, options.skip ? { skip: options.skip } : {}).exec();
      res.status(200).json({ count });
    } catch (error) {
      this.queryError(res, error, model, false);
    }
  }

  @Get('v2/:model/:id')
  async item(@Req() req: AuthenticatedRequest, @Res() res: Response, @Next() next: NextFunction): Promise<void> {
    const model = this.ermModel(String(req.params.model));
    if (!model) { next(); return; }
    await parseBody(req, res);
    const prepared = await this.prepare(req, res, model);
    if (!prepared) return;
    const { options, context } = prepared;
    try {
      const conditions = this.conditions(context, options, { _id: req.params.id });
      if (options.distinct) {
        const values = await model.distinct(options.distinct as string, conditions).exec();
        res.status(200).json(values);
        return;
      }
      const query = model.findOne(conditions);
      const projection = this.projection(context, options);
      if (projection) query.select(projection as Record<string, number>);
      if (options.skip) query.skip(options.skip);
      if (options.sort) query.sort(options.sort as string);
      if (options.populate) query.populate(populateOptions(options.populate));
      const item = await query.exec();
      if (!item) {
        this.ermError(res, new ErmError('Not Found', 404));
        return;
      }
      res.status(200).json((item as unknown as ToObject).toObject());
    } catch (error) {
      this.queryError(res, error, model, true);
    }
  }

  private generatedModel(name: string): LegacyModel | undefined {
    const modelName = GENERATED_BY_NAME.get(name.toLowerCase());
    return modelName ? this.models[modelName] : undefined;
  }

  /** GET /connection/<modèle> : pagination Relay (premier = 10 par défaut ; `last` ignoré en pratique). */
  @Get('connection/:model')
  async connection(@Req() req: AuthenticatedRequest, @Res() res: Response, @Next() next: NextFunction): Promise<void> {
    const model = this.generatedModel(String(req.params.model));
    if (!model) { next(); return; }
    await parseBody(req, res);
    const user = await authenticateOr401(this.strategies, ['jwt', 'clientBasic'], req, res);
    if (!user) return;
    await catchErrors(res, this.logger, this.config.log.level, async () => {
      const query = req.query as Record<string, unknown>;
      const filter = jsonFromQuery(req, 'filter', {});
      const sort = jsonFromQuery(req, 'sort', { _id: 1 });
      const hint = jsonFromQuery(req, 'hint', undefined);
      const project = jsonFromQuery(req, 'project', undefined);
      const first = fromQuery<number | undefined>(req, 'first', undefined, (value) => Number.parseInt(String(value)));
      const last = fromQuery<number | undefined>(req, 'last', undefined, (value) => Number.parseInt(String(value)));
      const connection = await getConnection(this.scopes, model, {
        authInfo: getAuthFromRequest(req), filter, sort, before: query.before, after: query.after, first, last, hint, project,
        maxTimeMS: this.config.maxTimeMS,
      });
      res.status(200).send(connection);
    });
  }

  /** GET /indexes/<modèle> : `[{ key, name }]` de la collection (aucun contrôle de droits au-delà de l'authentification). */
  @Get('indexes/:model')
  async indexes(@Req() req: AuthenticatedRequest, @Res() res: Response, @Next() next: NextFunction): Promise<void> {
    const model = this.generatedModel(String(req.params.model));
    if (!model) { next(); return; }
    await parseBody(req, res);
    const user = await authenticateOr401(this.strategies, ['jwt', 'clientBasic'], req, res);
    if (!user) return;
    try {
      const indexes = await model.collection.indexes();
      res.status(200).json(indexes.map(({ key, name }) => ({ key, name })));
    } catch (error) {
      this.logger.error(error);
      res.status(500).send(error instanceof Error ? error.message : error);
    }
  }
}
