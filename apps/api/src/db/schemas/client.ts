// Code d'origine : legacy/lib/models/client.js. `authority` est stocké en chaîne JSON et exposé
// en objet (getter) ; toJSON applique les getters, donc aussi le virtuel `id`.
import { Schema } from 'mongoose';
import { CLIENT_SCOPES } from '@ll/shared';
import { timestampsPlugin } from '../timestamps.js';

export const clientSchema = new Schema({
  title: { type: String },
  api: {
    basic_key: { type: String },
    basic_secret: { type: String },
  },
  authority: {
    type: String,
    get: (value: string | undefined): unknown => (value ? JSON.parse(value) : {}),
    default: JSON.stringify({
      objectType: 'Agent',
      name: 'New Client',
      mbox: 'mailto:hello@learninglocker.net',
    }),
  },
  isTrusted: { type: Boolean, default: true },
  organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  lrs_id: { type: Schema.Types.ObjectId, ref: 'Lrs' },
  scopes: { type: [String], enum: Object.keys(CLIENT_SCOPES) },
}, {
  toObject: { getters: true },
  toJSON: { getters: true },
});
clientSchema.plugin(timestampsPlugin);
