// Code d'origine : legacy/lib/models/download.js.
import { Schema } from 'mongoose';
import { uploadSchema } from './upload.js';

export const downloadSchema = new Schema({
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  isReady: { type: Boolean, default: false },
  time: { type: Date },
  name: { type: String },
  url: { type: String },
  upload: uploadSchema,
  pipelines: { type: String },
  isPublic: { type: Boolean, default: false },
});
