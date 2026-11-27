// Code d'origine : legacy/lib/models/dashboard.js.
// La date par défaut d'un partage est évaluée une seule fois, au chargement du module (comme le
// legacy : `default: new Date()`) : un partage sans createdAt prend la date de démarrage du serveur.
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

export const NOWHERE = 'NOWHERE';
export const ANYWHERE = 'ANYWHERE';
export const VALID_DOMAINS = 'VALID_DOMAINS';
export const FILTER_OFF = 'OFF';
export const FILTER_ANY = 'ANY';
export const FILTER_JWT_SECURED = 'JWT_SECURED';

const widgetSchema = new Schema({
  title: { type: String },
  suggestedStep: { type: String },
  visualisation: { type: Schema.Types.ObjectId, ref: 'Visualisation' },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  w: { type: Number, default: 4 },
  h: { type: Number, default: 4 },
});

const MODULE_LOADED_AT = new Date();

const shareableSchema = new Schema({
  title: { type: String, default: '~ Shareable' },
  filter: { type: String, default: '{}' },
  oldFilter: { type: String, default: undefined },
  timezone: { type: String },
  visibility: { type: String, enum: [NOWHERE, ANYWHERE, VALID_DOMAINS], default: NOWHERE },
  validDomains: { type: String },
  createdAt: { type: Date, default: MODULE_LOADED_AT },
  filterMode: { type: String, enum: [FILTER_OFF, FILTER_ANY, FILTER_JWT_SECURED], default: FILTER_OFF },
  filterRequired: { type: Boolean, default: false },
  filterJwtSecret: { type: String, default: '' },
});

export const dashboardSchema = new Schema({
  title: { type: String },
  widgets: [widgetSchema],
  shareable: [shareableSchema],
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  isPublic: { type: Boolean, default: false },
  hasBeenMigrated: { type: Boolean, default: false },
  type: { type: String },
});
dashboardSchema.plugin(timestampsPlugin);
