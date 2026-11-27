// Code d'origine : legacy/lib/models/role.js.
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

export const roleSchema = new Schema({
  title: { type: String },
  description: { type: String },
  owner_id: { type: Schema.Types.ObjectId, ref: 'User' },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  scopes: [{ type: String }],
});
roleSchema.plugin(timestampsPlugin);
