// Dépendances réelles des filtres de droits (MongoDB via Mongoose) et de parseQuery.
// Code d'origine : legacy/lib/helpers/parseQuery.js (appel avec getScopeFilter et persona-service),
// node_modules/@learninglocker/persona-service@1.7.1/dist/mongoModelsRepo/getAttributes.js (pagination.js).
import mongoose from 'mongoose';
import { parseQuery, toObjectId, type ObjectIdFactory, type QueryDependencies } from '@ll/shared';
import type { AuthInfo } from '../auth/auth-info.js';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import type { Models } from '../db/models.js';
import { getScopeFilter, type ScopeDeps, type ScopeFilterOptions } from './scope-filter.js';

const { ObjectId } = mongoose.Types;

/** Fabrique d'ObjectId pour @ll/shared (bson du driver 7). */
export const objectIdFactory: ObjectIdFactory = {
  fromHex: (hex) => new ObjectId(hex),
  generate: (time) => (time === undefined ? new ObjectId() : ObjectId.createFromTime(time)),
};

/** `mongoose.Types.ObjectId(x)` du legacy (bson 1.1). */
export const legacyObjectId = (value: unknown): unknown => toObjectId(value, objectIdFactory);

export class ScopeService {
  readonly deps: ScopeDeps;
  readonly queryDeps: QueryDependencies;

  constructor(private readonly models: Models, config: ApiConfig, logger: Logger) {
    this.queryDeps = {
      getScopeFilter: (request) => getScopeFilter(this.deps, request as ScopeFilterOptions),
      getPersonaAttributes: async ({ filter, organisation }) => {
        // persona-service : `{ ...filter, organisation: new ObjectID(organisation) }` (erreur si invalide).
        const docs = await this.models.PersonaAttribute.collection
          .find({ ...filter, organisation: new ObjectId(organisation as string) }, { maxTimeMS: config.maxTimeMS || undefined })
          .toArray();
        return { edges: docs.map((node) => ({ node })) };
      },
      objectId: objectIdFactory,
      maxTimeMS: config.maxTimeMS,
      logError: (message, error) => { logger.error(message, error); },
    };
    this.deps = {
      objectId: legacyObjectId,
      findOrganisation: async (id) => {
        const org = await this.models.Organisation.findById(id);
        return org ? { expiration: org.get('expiration') } : null;
      },
      findRoleOrganisations: (roleIds, scopes) =>
        this.models.Role.find({ _id: { $in: roleIds }, scopes: { $in: scopes } }).select({ organisation: 1 }).lean() as Promise<{ organisation?: unknown }[]>,
      dashboardVisualisationIds: async (dashboardId) => {
        const rows = await this.models.Dashboard.aggregate<{ visualisationId?: unknown }>([
          { $match: { _id: dashboardId } },
          { $unwind: '$widgets' },
          { $project: { _id: 0, visualisationId: '$widgets.visualisation' } },
        ]);
        return rows.map((row) => row.visualisationId);
      },
      parseQuery: (filter, authInfo) => parseQuery(filter, { authInfo }, this.queryDeps),
      enableStatementDeletion: config.enableStatementDeletion,
      restrictCreateOrganisation: config.restrictCreateOrganisation,
    };
  }

  getScopeFilter(options: ScopeFilterOptions): Promise<unknown> {
    return getScopeFilter(this.deps, options);
  }

  /** parseQuery(requête, { authInfo }) : erreurs renvoyées à la place du résultat, comme le legacy. */
  parseQuery(query: unknown, authInfo: AuthInfo): Promise<unknown> {
    return parseQuery(query, { authInfo }, this.queryDeps);
  }
}
