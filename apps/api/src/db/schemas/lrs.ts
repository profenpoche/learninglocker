// Code d'origine : legacy/lib/models/lrs.js.
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

export const lrsSchema = new Schema({
  title: { type: String },
  description: { type: String },
  owner_id: { type: Schema.Types.ObjectId, ref: 'User' },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  statementCount: { type: Number, default: 0 },
});
lrsSchema.plugin(timestampsPlugin);
