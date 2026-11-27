// Jetons JWT de Learning Locker : mêmes revendications, même ordre, mêmes durées, HS256 et APP_SECRET.
// Code d'origine : legacy/api/src/auth/jwt.js et legacy/api/src/utils/getActiveOrgSettings.js.
import jsonwebtoken, { type SignOptions } from 'jsonwebtoken';
import { getOrganisationTokenScopes, VIEW_SHAREABLE_DASHBOARD } from '@ll/shared';
import type { Models } from '../db/models.js';
import type { TokenPayload } from './auth-info.js';

type Doc = Record<string, unknown> & { _id: unknown };
type StringValue = Exclude<SignOptions['expiresIn'], number | undefined>;

interface PayloadInput {
  userId?: unknown;
  provider?: unknown;
  scopes?: unknown;
  filter?: unknown;
  tokenType?: unknown;
  tokenId?: unknown;
  shareableId?: unknown;
  extensions?: unknown;
  organisation?: unknown;
}

/** payloadDefaults : provider « native », scopes [], extensions {}, organisation null (seulement si undefined). */
const payloadDefaults = ({ provider = 'native', scopes = [], extensions = {}, organisation = null, ...others }: PayloadInput): PayloadInput => ({
  provider, scopes, extensions, organisation, ...others,
});

/** getActiveOrgSettings : réglages de l'utilisateur pour l'organisation, ou `{ filter: '{}', roles: [] }`. */
export const getActiveOrgSettings = (user: Record<string, unknown>, orgId: unknown): { filter?: unknown; roles?: unknown } => {
  const all = user.organisationSettings as { organisation?: { toString(): string } }[] | undefined;
  const found = all?.find((settings) => {
    const org = settings.organisation;
    return Boolean(org) && org?.toString() === String(orgId);
  });
  return (found as { filter?: unknown; roles?: unknown } | undefined) ?? { filter: '{}', roles: [] };
};

const isEmptyValue = (value: unknown): boolean => {
  // lodash.isEmpty appliqué à un ObjectId ou à une chaîne.
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0 && !(value as { _bsontype?: unknown })._bsontype;
  return true;
};

export class JwtService {
  constructor(
    private readonly secret: string | undefined,
    private readonly accessExpiration: string,
    private readonly refreshExpiration: string,
    private readonly models: Models,
  ) {}

  /** createJWT : revendications dans l'ordre du legacy ; `undefined` disparaît du JSON. */
  createJWT(input: PayloadInput, expiresIn: string): Promise<string> {
    const { userId, provider, scopes, filter, tokenType, tokenId, shareableId = null, extensions, organisation = null } = input;
    return new Promise((resolve, reject) => {
      try {
        resolve(jsonwebtoken.sign(
          JSON.parse(JSON.stringify({ userId, provider, scopes, tokenType, tokenId, shareableId, extensions, filter, organisation })) as object,
          this.secret as string,
          { expiresIn: expiresIn as StringValue, algorithm: 'HS256' },
        ));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** jwt.verify (HS256 seulement, D7 : le legacy acceptait toute variante HMAC). */
  verify(token: unknown): TokenPayload {
    return jsonwebtoken.verify(token as string, this.secret as string, { algorithms: ['HS256'] }) as TokenPayload;
  }

  createUserTokenPayload(user: Doc, provider?: unknown): PayloadInput {
    return payloadDefaults({
      userId: String(user._id),
      provider,
      scopes: user.scopes,
      tokenType: 'user',
      tokenId: String(user._id),
    });
  }

  createUserJWT(user: Doc, provider?: unknown): Promise<string> {
    return this.createJWT(this.createUserTokenPayload(user, provider), this.accessExpiration);
  }

  createUserRefreshJWT(user: Doc, provider?: unknown): Promise<string> {
    return this.createJWT(payloadDefaults({
      userId: String(user._id),
      provider,
      scopes: ['refresh_token_user'],
      tokenType: 'user_refresh',
      tokenId: String(user._id),
    }), this.refreshExpiration);
  }

  async createOrgTokenPayload(user: Doc, orgId: unknown, provider?: unknown): Promise<PayloadInput> {
    const activeOrgSettings = getActiveOrgSettings(user, orgId);
    const roles = await this.models.Role.find({ _id: { $in: activeOrgSettings.roles } });
    const roleScopes = roles.map((role) => [...((role.get('scopes') as string[] | undefined) ?? [])]);
    const scopes = getOrganisationTokenScopes(roleScopes, [...((user.scopes as string[] | undefined) ?? [])]);
    const filter: unknown = JSON.parse(activeOrgSettings.filter as string);
    return payloadDefaults({
      userId: String(user._id),
      provider,
      tokenType: 'organisation',
      tokenId: orgId,
      filter,
      scopes,
    });
  }

  async createOrgJWT(user: Doc, organisationId: unknown, provider?: unknown): Promise<string> {
    return this.createJWT(await this.createOrgTokenPayload(user, organisationId, provider), this.accessExpiration);
  }

  createOrgRefreshJWT(user: Doc, organisationId: unknown, provider?: unknown): Promise<string> {
    return this.createJWT(payloadDefaults({
      userId: String(user._id),
      provider,
      scopes: ['refresh_token_organisation'],
      tokenType: 'organisation_refresh',
      tokenId: organisationId,
    }), this.refreshExpiration);
  }

  /**
   * createDashboardTokenPayload. Sans partage désigné, le premier partage est pris : son identifiant
   * reste alors un ObjectId (comme le legacy), ce qui compte pour la vérification du jeton.
   */
  async createDashboardTokenPayload(dashboard: Doc, shareableId: unknown, provider?: unknown): Promise<PayloadInput> {
    const shareable = (dashboard.shareable as { _id: unknown }[] | undefined) ?? [];
    let shareId = shareableId;
    if (!shareId && shareable.length > 0) shareId = shareable[0]?._id;
    const widgets = (dashboard.widgets as { visualisation?: unknown }[] | undefined) ?? [];
    const visualisationIds = widgets.map((widget) => widget.visualisation)
      .filter((id) => !isEmptyValue(id))
      .map((id) => (id === null || id === undefined ? '' : (id as { toString(): string }).toString()));
    const org = await this.models.Organisation.findOne({ _id: dashboard.organisation });
    const orgTimezone = org && org.get('timezone') ? org.get('timezone') as string : null;
    return payloadDefaults({
      provider,
      scopes: [VIEW_SHAREABLE_DASHBOARD],
      tokenType: 'dashboard',
      tokenId: String(dashboard._id),
      shareableId: shareId,
      organisation: String(dashboard.organisation),
      filter: {},
      extensions: { visualisationIds, orgTimezone },
    });
  }

  async createDashboardJWT(dashboard: Doc, shareableId: unknown, provider?: unknown): Promise<string> {
    return this.createJWT(await this.createDashboardTokenPayload(dashboard, shareableId, provider), this.accessExpiration);
  }
}
