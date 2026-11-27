// Code d'origine : legacy/lib/models/visualisation.js (validateurs JSON non portés : écritures relayées).
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';

const statementContents = new Schema({
  Path: { type: String },
  Title: { type: String },
  User_Title: { type: Schema.Types.ObjectId, ref: 'Visualisation' },
});

export const visualisationSchema = new Schema({
  description: { type: String },
  type: { type: String },
  axes: { type: String },
  axesgroup: { type: String },
  axesxLabel: { type: String },
  axesxValue: { type: String },
  axesxOperator: { type: String },
  axesxQuery: { type: String },
  oldAxesxQuery: { type: String },
  axesyLabel: { type: String },
  axesyValue: { type: String },
  axesyOperator: { type: String },
  axesyQuery: { type: String },
  oldAxesyQuery: { type: String },
  axesvalue: { type: String },
  axesquery: { type: String },
  axesoperator: { type: String },
  stacked: { type: Boolean, default: true },
  trendLines: { type: Boolean, default: false },
  sourceView: { type: Boolean, default: false },
  filters: [{ type: String, default: ['{$match: {}}'] }],
  oldFilters: { type: [{ type: String, default: ['{$match: {}}'] }], default: undefined },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  suggestedStep: { type: String },
  previewPeriod: { type: String, default: 'LAST_7_DAYS' },
  benchmarkingEnabled: { type: Boolean, default: false },
  isDonut: { type: Boolean, default: false },
  isPublic: { type: Boolean, default: false },
  barChartGroupingLimit: { type: Number, default: 10 },
  statementContents: [statementContents],
  hasBeenMigrated: { type: Boolean, default: false },
  timezone: { type: String },
  showStats: { type: Boolean, default: true },
  statsAtBottom: { type: Boolean, default: true },
  contextLabel: { type: String },
});
visualisationSchema.plugin(timestampsPlugin);
