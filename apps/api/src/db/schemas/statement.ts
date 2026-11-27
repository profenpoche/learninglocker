// Code d'origine : legacy/lib/models/statement.js (schéma seulement).
import { Schema } from 'mongoose';

export const statementSchema = new Schema({
  lrs: { type: Schema.Types.Mixed },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  lrs_id: { type: Schema.Types.ObjectId, ref: 'Lrs' },
  person: { _id: { type: Schema.Types.ObjectId, ref: 'Persona' }, display: { type: String } },
  personaIdentifier: { type: Schema.Types.ObjectId, ref: 'PersonaIdentifier' },
  active: { type: Boolean },
  voided: { type: Boolean },
  timestamp: { type: Date },
  stored: { type: Date },
  refs: { type: Schema.Types.Mixed },
  statement: { type: Schema.Types.Mixed },
  client_id: { type: Schema.Types.String },
  client: { type: Schema.Types.ObjectId, ref: 'Client' },
  completedQueues: [{ type: String }],
  processingQueues: [{ type: String }],
  deadForwardingQueue: [{ type: Schema.Types.ObjectId, ref: 'StatementForwarding' }],
  failedForwardingLog: [{
    statementForwarding_id: { type: Schema.Types.ObjectId, ref: 'StatementForwarding' },
    timestamp: Date,
    message: String,
    errorInfo: Object,
  }],
  pendingForwardingQueue: [{ type: Schema.Types.ObjectId, ref: 'StatementForwarding' }],
  completedForwardingQueue: [{ type: Schema.Types.ObjectId, ref: 'StatementForwarding' }],
  hash: { type: String },
  metadata: { type: Schema.Types.Mixed },
});
