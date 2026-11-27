// Modèles plus simples. Codes d'origine : legacy/lib/models/{personaAttribute,querybuildercache,
// querybuildercachevalue,batchDelete,siteSettings,stream,personasImportTemplate,oAuthToken}.js.
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

export const personaAttributeSchema = new Schema({
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  personaId: { type: Schema.Types.ObjectId, ref: 'Persona' },
  key: { type: String, required: true },
  value: { type: Schema.Types.Mixed, required: true },
});
personaAttributeSchema.plugin(timestampsPlugin);

export const queryBuilderCacheSchema = new Schema({
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  path: [{ type: String }],
  searchString: { type: String },
  valueType: { type: String },
});
queryBuilderCacheSchema.plugin(timestampsPlugin);

export const queryBuilderCacheValueSchema = new Schema({
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  path: { type: String },
  hash: { type: String },
  value: { type: Schema.Types.Mixed },
  display: { type: Schema.Types.Mixed, default: null },
  valueType: { type: String },
  searchString: { type: String },
});
queryBuilderCacheValueSchema.plugin(timestampsPlugin);

export const batchDeleteSchema = new Schema({
  client: { type: Schema.Types.ObjectId, ref: 'Client' },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  pageSize: { type: Number, default: 1000 },
  total: { type: Number },
  deleteCount: { type: Number },
  filter: { type: String },
  processing: { type: Boolean, default: false },
  done: { type: Boolean, default: false },
});
batchDeleteSchema.plugin(timestampsPlugin);

export const siteSettingsSchema = new Schema({
  dontShowRegistration: { type: Boolean, default: false },
  batchDeleteWindowUTCHour: { type: Number, default: null },
  batchDeleteWindowUTCMinutes: { type: Number, default: null },
  batchDeleteWindowDurationSeconds: { type: Number, default: 60 * 60 },
});
siteSettingsSchema.plugin(timestampsPlugin);

const outcomeSchema = new Schema({
  description: { type: String },
  isActive: { type: Boolean, default: true },
  callback: { type: String },
  type: { type: String },
});

export const streamSchema = new Schema({
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  hash: { type: String },
  description: { type: String },
  outcomes: { type: [outcomeSchema] },
  conditions: { type: String },
});

export const personasImportTemplateSchema = new Schema({
  name: { type: String },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  isPublic: { type: Boolean, default: false },
});
personasImportTemplateSchema.plugin(timestampsPlugin);

export const oAuthTokenSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: 'Client' },
  accessToken: { type: String },
  createdAt: { type: Date },
  expireAt: { type: Date },
});
