// Sous-document de fichier stocké (logo d'organisation, export).
// Code d'origine : legacy/lib/models/uploadSchema.js.
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

export const uploadSchema = new Schema({
  mime: { type: String },
  key: { type: String },
  repo: { type: String },
}, { _id: false });
uploadSchema.plugin(timestampsPlugin);
