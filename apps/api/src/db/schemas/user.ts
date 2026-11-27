// Code d'origine : legacy/lib/models/user.js. Les hooks d'écriture (fusion d'un utilisateur existant,
// hachage et historique des mots de passe) seront portés avec les écritures REST ; seul ce qu'exigent
// la connexion et la réinitialisation du mot de passe est porté ici (voir auth/user-save.ts).
import { Schema, type HydratedDocument } from 'mongoose';
import { nextPasswordHistory, validatePassword, type PasswordHistoryItem, type PasswordSettings } from '@ll/shared';
import { compareHash, hashLegacy } from '../../security/bcrypt.js';
import { timestampsPlugin } from '../timestamps.js';

type UserDocument = HydratedDocument<Record<string, unknown>> & {
  _original?: Record<string, unknown>;
  [key: string]: unknown;
};

export const userSchema = new Schema({
  name: { type: String },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    validate: {
      async validator(this: UserDocument, value: unknown): Promise<boolean> {
        const found = await (this.constructor as unknown as { countDocuments(filter: object): Promise<number> })
          .countDocuments({ email: value, _id: { $ne: this._id } });
        if (found) throw new Error('Email already exists');
        return true;
      },
    },
  },
  organisations: [{ type: Schema.Types.ObjectId, ref: 'Organisation' }],
  organisationSettings: [{
    organisation: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    scopes: [{ type: String }],
    roles: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
    filter: { type: String, default: '{}' },
    oldFilter: { type: String, default: undefined },
    timezone: { type: String },
  }],
  imageUrl: { type: String },
  googleId: { type: String },
  password: {
    type: String,
    validate: {
      async validator(this: UserDocument, value: string): Promise<boolean> {
        return validatePassword({
          value,
          modified: this.isModified('password'),
          settings: this.get('ownerOrganisationSettings') as PasswordSettings,
          history: this.get('passwordHistory') as PasswordHistoryItem[],
          comparePassword: compareHash,
        });
      },
    },
  },
  ownerOrganisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
  ownerOrganisationSettings: {
    LOCKOUT_ENABLED: { type: Boolean, default: true },
    LOCKOUT_ATTEMPS: { type: Number, default: 5 },
    LOCKOUT_SECONDS: { type: Number, default: 1800 },
    PASSWORD_HISTORY_CHECK: { type: Boolean, default: true },
    PASSWORD_HISTORY_TOTAL: { type: Number, default: 3 },
    PASSWORD_MIN_LENGTH: { type: Number, default: 8 },
    PASSWORD_REQUIRE_ALPHA: { type: Boolean, default: true },
    PASSWORD_REQUIRE_NUMBER: { type: Boolean, default: true },
    PASSWORD_USE_CUSTOM_REGEX: { type: Boolean, default: false },
    PASSWORD_CUSTOM_REGEX: { type: String, default: null },
    PASSWORD_CUSTOM_MESSAGE: { type: String, default: null },
  },
  settings: {
    CONFIRM_BEFORE_DELETE: { type: Boolean, default: true },
  },
  scopes: [{ type: String }],
  verified: { type: Boolean, default: false },
  resetTokens: [{
    token: { type: String },
    expires: { type: Date },
  }],
  passwordHistory: {
    type: [{
      hash: { type: String },
      date: { type: Date },
    }],
    default: [],
  },
  authLastAttempt: { type: Date, default: null },
  authFailedAttempts: { type: Number, default: 0 },
  authLockoutExpiry: { type: Date, default: null },
  hasBeenMigrated: { type: Boolean, default: false },
});
userSchema.plugin(timestampsPlugin);

// --- Hooks d'enregistrement d'un utilisateur existant (connexion, réinitialisation du mot de passe).
// La création (fusion avec un utilisateur existant, courriel d'invitation) viendra avec les écritures REST.

userSchema.post('init', function handleInit(this: UserDocument) {
  this._original = this.toObject();
});

userSchema.pre('validate', function preValidate(this: UserDocument) {
  const organisations = (this.get('organisations') as { toString(): string }[] | undefined) ?? [];
  const seen = new Set<string>();
  this.set('organisations', organisations.filter((id) => {
    const key = String(id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
  if (!this.get('ownerOrganisation')) this.set('ownerOrganisation', (this.get('organisations') as unknown[])[0]);
});

/** preSavePasswordCheck : compte vérifié, hachage du nouveau mot de passe, historique, fin du verrouillage. */
userSchema.pre('save', async function preSavePasswordCheck(this: UserDocument) {
  if (!this.get('verified') && (this.get('password') || this.get('googleId'))) this.set('verified', true);
  let preventPasswordHash = false;
  const password = this.get('password') as string | undefined;
  if ((password === undefined ? '' : password).length === 0) {
    preventPasswordHash = true;
    const original = this._original?.password;
    this.set('password', original === undefined ? '' : original);
  }
  if (!preventPasswordHash && this.isModified('password')) {
    const hash = await hashLegacy(this.get('password') as string);
    this.set('password', hash);
    this.set('authFailedAttempts', 0);
    this.set('authLockoutExpiry', null);
    const history = ((this.get('passwordHistory') as { toObject(): PasswordHistoryItem }[] | undefined) ?? []).map((item) => item.toObject());
    const settings = this.get('ownerOrganisationSettings') as { PASSWORD_HISTORY_TOTAL?: unknown };
    this.set('passwordHistory', nextPasswordHistory(history, { date: new Date(), hash }, settings.PASSWORD_HISTORY_TOTAL));
  }
});
