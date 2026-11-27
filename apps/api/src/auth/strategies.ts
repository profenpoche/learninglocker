// Stratégies d'authentification, avec la sémantique exacte de passport 0.4 et de ses stratégies :
// passport-http-bearer 1.0.1 (jwt), passport-custom 1.1.0 (jwt-cookie, OAuth2_Authorization),
// passport-http 0.3.0 (Basic : userBasic, clientBasic).
// Code d'origine : legacy/api/src/auth/passport.js, legacy/ui/src/utils/auth.js (noms des cookies).
import type { Request } from 'express';
import type { Logger } from '../core/logger.js';
import type { Models } from '../db/models.js';
import type { AuthenticatedUser, AuthInfo, AuthUserDoc, ClientDoc } from './auth-info.js';
import type { JwtService } from './jwt.js';

export type Outcome =
  | { type: 'success'; user: AuthenticatedUser }
  | { type: 'fail'; challenge?: string; status?: number }
  | { type: 'error'; error: unknown };

export type StrategyName = 'jwt' | 'jwt-cookie' | 'clientBasic';

const REALM = 'Users';
const BEARER_CHALLENGE = `Bearer realm="${REALM}"`;
const BASIC_CHALLENGE = `Basic realm="${REALM}"`;

const fail = (challengeOrStatus?: string | number): Outcome => (typeof challengeOrStatus === 'number'
  ? { type: 'fail', status: challengeOrStatus }
  : { type: 'fail', challenge: challengeOrStatus });

/** Résultat de passport-http BasicStrategy avant vérification. */
export type BasicCredentials = { type: 'credentials'; userid: string; password: string } | Outcome;

/** BasicStrategy.authenticate : le mot de passe s'arrête au premier « : » (comportement d'origine). */
export const readBasicCredentials = (req: Request): BasicCredentials => {
  const authorization = req.headers.authorization;
  if (!authorization) return fail(BASIC_CHALLENGE);
  const parts = authorization.split(' ');
  if (parts.length < 2) return fail(400);
  const scheme = parts[0] ?? '';
  const credentials = Buffer.from(parts[1] ?? '', 'base64').toString().split(':');
  if (!/Basic/i.test(scheme)) return fail(BASIC_CHALLENGE);
  if (credentials.length < 2) return fail(400);
  const userid = credentials[0] ?? '';
  const password = credentials[1] ?? '';
  if (!userid || !password) return fail(BASIC_CHALLENGE);
  return { type: 'credentials', userid, password };
};

const errorName = (error: unknown): unknown => (error as { name?: unknown } | null)?.name;

/** Comparaison `Immutable.is` (Immutable 3.8) des valeurs passées par `fromJS`. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && (value.constructor === Object || (value as { constructor?: unknown }).constructor === undefined);

export const immutableEquals = (a: unknown, b: unknown): boolean => {
  if (a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))) return true;
  const listA = Array.isArray(a);
  const listB = Array.isArray(b);
  if (listA || listB) {
    if (!listA || !listB || a.length !== b.length) return false;
    return a.every((item, i) => immutableEquals(item, (b as unknown[])[i]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) return false;
    return keysA.every((key) => Object.hasOwn(b, key) && immutableEquals(a[key], b[key]));
  }
  if (!a || !b) return false;
  let valueA: unknown = a;
  let valueB: unknown = b;
  if (typeof (a as { valueOf?: unknown }).valueOf === 'function' && typeof (b as { valueOf?: unknown }).valueOf === 'function') {
    valueA = (a as { valueOf(): unknown }).valueOf();
    valueB = (b as { valueOf(): unknown }).valueOf();
    if (valueA === valueB || (typeof valueA === 'number' && typeof valueB === 'number' && Number.isNaN(valueA) && Number.isNaN(valueB))) return true;
    if (!valueA || !valueB) return false;
  }
  const equalsA = (valueA as { equals?: unknown }).equals;
  const equalsB = (valueB as { equals?: unknown }).equals;
  return typeof equalsA === 'function' && typeof equalsB === 'function' && Boolean((equalsA as (x: unknown) => unknown).call(valueA, valueB));
};

/** Valeur de requête interdite dans un filtre (objet : injection d'opérateurs MongoDB). Correctif D7. */
export const isQueryObject = (value: unknown): boolean => typeof value === 'object' && value !== null;

export class Strategies {
  constructor(
    private readonly models: Models,
    private readonly jwt: JwtService,
    private readonly logger: Logger,
  ) {}

  /** verifyToken : vérifie la signature puis régénère la charge attendue depuis la base. */
  async verifyToken(token: unknown): Promise<Outcome> {
    try {
      const decoded = this.jwt.verify(token);
      const user = decoded.userId ? await this.models.User.findOne({ _id: decoded.userId }) : undefined;
      const dashboard = decoded.tokenType === 'dashboard' ? await this.models.Dashboard.findOne({ _id: decoded.tokenId }) : undefined;
      const userDoc = user as unknown as AuthUserDoc & Record<string, unknown> & { _id: unknown };
      let expected: Record<string, unknown>;
      switch (decoded.tokenType) {
        case 'organisation':
          expected = { ...await this.jwt.createOrgTokenPayload(userDoc, decoded.tokenId, decoded.provider) };
          break;
        case 'dashboard': {
          const shareables = ((dashboard as unknown as Record<string, unknown>).shareable as { _id: { toString(): string } }[] | undefined) ?? [];
          const shareable = shareables.find((share) => share._id.toString() === decoded.shareableId);
          expected = { ...await this.jwt.createDashboardTokenPayload(
            dashboard as unknown as Record<string, unknown> & { _id: unknown },
            shareable ? shareable._id.toString() : null,
            decoded.provider,
          ) };
          break;
        }
        default:
          expected = { ...this.jwt.createUserTokenPayload(userDoc, decoded.provider) };
      }
      const toVerify: Record<string, unknown> = { ...decoded };
      delete toVerify.iat;
      delete toVerify.exp;
      if (!toVerify.shareableId) delete toVerify.shareableId;
      delete toVerify.filter;
      delete expected.filter;
      if (!immutableEquals(expected, toVerify)) {
        throw Object.assign(new Error('Unauthorised'), { name: 'Unauthorised' });
      }
      const plainUser = user ? user.toObject() : {};
      return {
        type: 'success',
        user: { ...plainUser, authInfo: { user: user ? userDoc : undefined, token: decoded } },
      };
    } catch (error) {
      if (errorName(error) === 'TokenExpiredError' || errorName(error) === 'JsonWebTokenError') return { type: 'fail' };
      this.logger.error('Auth error:', error);
      return { type: 'error', error };
    }
  }

  /** passport-http-bearer : en-tête Bearer, champ `access_token` du corps ou de la query string. */
  async bearer(req: Request): Promise<Outcome> {
    let token: unknown;
    const authorization = req.headers.authorization;
    if (authorization) {
      const parts = authorization.split(' ');
      if (parts.length === 2) {
        if (/^Bearer$/i.test(parts[0] ?? '')) token = parts[1];
      } else {
        return fail(400);
      }
    }
    const body = req.body as Record<string, unknown> | undefined;
    if (body?.access_token) {
      if (token) return fail(400);
      token = body.access_token;
    }
    const query = req.query as Record<string, unknown>;
    if (query.access_token) {
      if (token) return fail(400);
      token = query.access_token;
    }
    if (!token) return fail(BEARER_CHALLENGE);
    const outcome = await this.verifyToken(token);
    if (outcome.type === 'fail') return fail(`${BEARER_CHALLENGE}, error="invalid_token"`);
    return outcome;
  }

  /** jwt-cookie : cookie du jeton d'organisation de l'URL, sinon premier cookie de jeton utilisateur. */
  async cookie(req: Request): Promise<Outcome> {
    const cookies = (req.cookies as Record<string, unknown> | undefined) ?? {};
    const organisationId = (req.params as Record<string, string | undefined>).organisationId;
    const cookieName = organisationId
      ? `access_token_organisation_${organisationId}`
      : Object.keys(cookies).find((key) => key.startsWith('access_token_user_'));
    const token = cookieName === undefined ? undefined : cookies[cookieName];
    const outcome = await this.verifyToken(token);
    return outcome.type === 'fail' ? fail(undefined) : outcome;
  }

  /** clientBasic : clé et secret d'un client API de confiance (secret comparé en clair). */
  async clientBasic(req: Request): Promise<Outcome> {
    const credentials = readBasicCredentials(req);
    if (credentials.type !== 'credentials') return credentials;
    try {
      const client = await this.models.Client.findOne({ 'api.basic_key': credentials.userid });
      if (!client) return fail(BASIC_CHALLENGE);
      if (!client.get('isTrusted')) return fail(BASIC_CHALLENGE);
      const clientDoc = client as unknown as ClientDoc & AuthenticatedUser;
      const authInfo: AuthInfo = { client: clientDoc, scopes: client.get('scopes'), token: { tokenType: 'client' } };
      clientDoc.authInfo = authInfo;
      if (client.get('api.basic_secret') === credentials.password) return { type: 'success', user: clientDoc };
      return fail(BASIC_CHALLENGE);
    } catch (error) {
      return { type: 'error', error };
    }
  }

  run(name: StrategyName, req: Request): Promise<Outcome> {
    switch (name) {
      case 'jwt': return this.bearer(req);
      case 'jwt-cookie': return this.cookie(req);
      case 'clientBasic': return this.clientBasic(req);
    }
  }
}
