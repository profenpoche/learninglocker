// Modèles Mongoose : mêmes noms de modèles et de collections que le legacy (legacy/lib/models/*.js).
// Les documents sont typés de façon lâche (champs hérités tolérés : `strict` ne s'applique pas à la lecture).
import type { Connection, Model, Schema } from 'mongoose';
import { clientSchema } from './schemas/client.js';
import { dashboardSchema } from './schemas/dashboard.js';
import { downloadSchema } from './schemas/download.js';
import { exportSchema } from './schemas/export.js';
import { importCsvSchema } from './schemas/importcsv.js';
import { lrsSchema } from './schemas/lrs.js';
import {
  batchDeleteSchema, oAuthTokenSchema, personaAttributeSchema, personasImportTemplateSchema, queryBuilderCacheSchema,
  queryBuilderCacheValueSchema, siteSettingsSchema, streamSchema,
} from './schemas/misc.js';
import { organisationSchema } from './schemas/organisation.js';
import { personasImportSchema } from './schemas/personasImport.js';
import { querySchema } from './schemas/query.js';
import { roleSchema } from './schemas/role.js';
import { statementSchema } from './schemas/statement.js';
import { statementForwardingSchema } from './schemas/statementForwarding.js';
import { userSchema } from './schemas/user.js';
import { visualisationSchema } from './schemas/visualisation.js';

export type LegacyRecord = Record<string, unknown>;
export type LegacyModel = Model<LegacyRecord>;

/** [nom du modèle, schéma, collection] */
const DEFINITIONS = [
  ['Organisation', organisationSchema, 'organisations'],
  ['User', userSchema, 'users'],
  ['Lrs', lrsSchema, 'lrs'],
  ['Client', clientSchema, 'client'],
  ['Role', roleSchema, 'role'],
  ['Visualisation', visualisationSchema, 'visualisations'],
  ['Dashboard', dashboardSchema, 'dashboards'],
  ['Query', querySchema, 'queries'],
  ['Export', exportSchema, 'exports'],
  ['Download', downloadSchema, 'downloads'],
  ['ImportCsv', importCsvSchema, 'importcsv'],
  ['StatementForwarding', statementForwardingSchema, 'statementForwarding'],
  ['PersonasImport', personasImportSchema, 'personasImports'],
  ['PersonaAttribute', personaAttributeSchema, 'personaAttributes'],
  ['QueryBuilderCache', queryBuilderCacheSchema, 'queryBuilderCaches'],
  ['QueryBuilderCacheValue', queryBuilderCacheValueSchema, 'queryBuilderCacheValues'],
  ['BatchDelete', batchDeleteSchema, 'batchDelete'],
  ['SiteSettings', siteSettingsSchema, 'siteSettings'],
  ['Statement', statementSchema, 'statements'],
  ['Stream', streamSchema, 'streams'],
  ['PersonasImportTemplate', personasImportTemplateSchema, 'personasImportTemplates'],
  ['OAuthToken', oAuthTokenSchema, 'oAuthTokens'],
] as const satisfies readonly (readonly [string, Schema, string])[];

export type ModelName = (typeof DEFINITIONS)[number][0];
export type Models = Record<ModelName, LegacyModel>;

export const createModels = (connection: Connection): Models => {
  const models = {} as Record<string, LegacyModel>;
  for (const [name, schema, collection] of DEFINITIONS) {
    models[name] = connection.model(name, schema as Schema, collection) as unknown as LegacyModel;
  }
  return models as Models;
};
