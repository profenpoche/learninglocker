// Code d'origine : legacy/lib/models/personasImport.js et legacy/lib/constants/personasImport.js
// (validateurs de `structure` non portés : écritures relayées).
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

export const STAGE_UPLOAD = 'STAGE_UPLOAD';
export const STAGE_CONFIGURE_FIELDS = 'STAGE_CONFIGURE_FIELDS';
export const STAGE_IMPORTED = 'STAGE_IMPORTED';
export const STAGE_PROCESSING = 'STAGE_PROCESSING';
/** moment(8640000000000000).toDate() : plus grande date représentable. */
const DATE_INFINITY = 8640000000000000;

export const personasImportSchema = new Schema({
  title: { type: String },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  csvHandle: { type: String },
  csvErrorHandle: { type: String },
  importStage: {
    type: String,
    enum: [STAGE_UPLOAD, STAGE_CONFIGURE_FIELDS, STAGE_PROCESSING, STAGE_IMPORTED],
    default: STAGE_UPLOAD,
  },
  totalCount: { type: Number },
  processedCount: { type: Number, default: 0 },
  csvHeaders: [{ type: String }],
  importedAt: { type: Date, default: new Date(DATE_INFINITY) },
  importErrors: {
    type: [{
      row: { type: Number },
      rowErrors: [{ type: String }],
    }],
  },
  result: {
    created: { type: Number, default: 0 },
    merged: { type: Number, default: 0 },
  },
  structure: { type: Schema.Types.Mixed },
});
personasImportSchema.plugin(timestampsPlugin);
