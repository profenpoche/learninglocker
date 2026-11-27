// Code d'origine : legacy/lib/models/statementForwarding.js et legacy/lib/constants/statementForwarding.js
// (validateurs non portés : écritures relayées).
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

export const AUTH_TYPE_NO_AUTH = 'no auth';
export const AUTH_TYPES = [AUTH_TYPE_NO_AUTH, 'token', 'basic auth'];
export const STATEMENT_FORWARDING_MAX_RETRIES = 10;

export const statementForwardingSchema = new Schema({
  description: { type: String },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  lrs_id: { type: Schema.Types.ObjectId, ref: 'Lrs' },
  active: { type: Boolean },
  timezone: { type: String },
  configuration: {
    protocol: { enum: ['http', 'https'], type: String, default: 'http' },
    url: { type: String },
    authType: { enum: AUTH_TYPES, type: String, default: AUTH_TYPE_NO_AUTH },
    secret: { type: String },
    basicUsername: { type: String },
    basicPassword: { type: String },
    maxRetries: { type: Number, min: 0, max: STATEMENT_FORWARDING_MAX_RETRIES },
    headers: { type: String },
  },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  query: { type: String },
  oldQuery: { type: String },
  hasBeenMigrated: { type: Boolean, default: false },
  isPublic: { type: Boolean, default: false },
  fullDocument: { type: Boolean, default: false },
  sendAttachments: { type: Boolean, default: false },
});
statementForwardingSchema.plugin(timestampsPlugin);
