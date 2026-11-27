// Code d'origine : legacy/lib/models/organisation.js. Lecture seule pour l'instant : les validateurs
// et les hooks d'écriture (rôles par défaut, propagation des réglages…) seront portés avec les écritures.
import { Schema } from 'mongoose';
import { timestampsPlugin } from '../timestamps.js';
import { uploadSchema } from './upload.js';

export const EMAIL_NOOP = 'EMAIL_NOOP';
const EMAIL_STATUS = [EMAIL_NOOP, 'EMAIL_PROCESSING', 'EMAIL_SENT'];

export const organisationSchema = new Schema({
  name: { type: String },
  logoPath: { type: String },
  logo: { type: uploadSchema },
  customColors: { type: [String], default: [] },
  parent: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  expiration: { type: Date },
  expirationNotifications: {
    weekBeforeNotificationSent: { type: String, enum: EMAIL_STATUS, default: EMAIL_NOOP },
    expirationNotificationSent: { type: String, enum: EMAIL_STATUS, default: EMAIL_NOOP },
  },
  usageStats: {
    RUN_DATETIME: { type: Date },
    HAS_CHILDREN: { type: Boolean },
    OWN_COUNT: { type: Number },
    TOTAL_COUNT: { type: Number },
    OWN_ESTIMATED_BYTES: { type: Number },
    TOTAL_ESTIMATED_BYTES: { type: Number },
  },
  settings: {
    LOCKOUT_ENABLED: { type: Boolean, default: true },
    LOCKOUT_ATTEMPS: { type: Number, default: 5 },
    LOCKOUT_SECONDS: { type: Number, default: 1800 },
    PASSWORD_HISTORY_CHECK: { type: Boolean, default: true },
    PASSWORD_HISTORY_TOTAL: { type: Number, default: 3 },
    PASSWORD_MIN_LENGTH: { type: Number, default: 8 },
    PASSWORD_REQUIRE_ALPHA: { type: Boolean, default: true },
    PASSWORD_REQUIRE_NUMBER: { type: Boolean, default: false },
    PASSWORD_USE_CUSTOM_REGEX: { type: Boolean, default: false },
    PASSWORD_CUSTOM_REGEX: { type: String, default: null },
    PASSWORD_CUSTOM_MESSAGE: { type: String, default: null },
  },
  timezone: { type: String },
});
organisationSchema.plugin(timestampsPlugin);
