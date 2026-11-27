// Code d'origine : legacy/lib/models/importcsv.js.
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

const matchedIndexesSchema = new Schema({
  usernameIndex: { type: Number, default: -1 },
  emailIndex: { type: Number, default: -1 },
  firstnameIndex: { type: Number, default: -1 },
  lastnameIndex: { type: Number, default: -1 },
  openIdIndex: { type: Number, default: -1 },
  nameIndex: { type: Number, default: -1 },
  homePageIndex: { type: Number, default: -1 },
});

const customIndexSchema = new Schema({
  fieldName: { type: String },
  index: { type: Number, default: -1 },
});

export const importCsvSchema = new Schema({
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  matchedIndexes: { type: matchedIndexesSchema },
  customIndexes: { type: [customIndexSchema] },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  uploadStatus: {
    inProgress: { type: Boolean, default: false },
    totalCount: { type: Number, default: 0, min: 0 },
    remainingCount: { type: Number, default: 0, min: 0 },
  },
});
importCsvSchema.plugin(timestampsPlugin);
