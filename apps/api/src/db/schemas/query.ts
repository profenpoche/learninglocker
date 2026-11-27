// Code d'origine : legacy/lib/models/query.js (conditions stockées en chaîne JSON, exposées en objet).
import { Schema } from 'mongoose';

const parseConditions = (conditions: string | undefined): unknown => (conditions ? JSON.parse(conditions) : {});

export const querySchema = new Schema({
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  name: { type: String },
  conditions: { type: String, get: parseConditions, default: '{}' },
  oldConditions: { type: String, get: parseConditions, default: '{}' },
  isPublic: { type: Boolean, default: false },
  hasBeenMigrated: { type: Boolean, default: false },
}, {
  toObject: { getters: true },
  toJSON: { getters: true },
});
