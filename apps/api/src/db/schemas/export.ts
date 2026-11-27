// Code d'origine : legacy/lib/models/export.js et legacy/lib/constants/exports.js.
import { Schema } from 'mongoose';

export const defaultProjection = JSON.stringify({
  _id: 1,
  version: '$statement.version',
  id: '$statement.id',
  timestamp: '$statement.timestamp',
  stored: '$statement.stored',
  actor: '$statement.actor',
  verb: '$statement.verb',
  object: '$statement.object',
  result: '$statement.result',
  authority: '$statement.authority',
  context: '$statement.context',
});

export const exportSchema = new Schema({
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  name: { type: String },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  projections: { type: [{ type: String }], default: [defaultProjection] },
  type: { type: String },
  rawMode: { type: Boolean, default: false },
  downloads: [{ type: Schema.Types.ObjectId, ref: 'Download' }],
  isPublic: { type: Boolean, default: false },
});
