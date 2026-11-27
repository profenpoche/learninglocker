// Informations d'authentification attachées à la requête (`req.user.authInfo` du legacy) et leurs
// sélecteurs. Codes d'origine : legacy/lib/services/auth/authInfoSelectors/*.js,
// legacy/lib/helpers/getAuthFromRequest.js.
import type { Request } from 'express';

export interface TokenPayload {
  userId?: string;
  provider?: string;
  scopes?: string[];
  tokenType?: string;
  tokenId?: string;
  shareableId?: string | null;
  extensions?: Record<string, unknown>;
  filter?: unknown;
  organisation?: string | null;
  organisationId?: unknown;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

/** authInfo d'un jeton (`{ user, token }`) ou d'un client Basic (`{ client, scopes, token }`). */
export interface AuthInfo {
  user?: AuthUserDoc | null;
  client?: ClientDoc;
  scopes?: unknown;
  token?: TokenPayload;
}

/** Document Mongoose d'utilisateur ou de client (champs lus par l'API). */
export interface AuthUserDoc {
  _id: { toString(): string };
  [key: string]: unknown;
}
export interface ClientDoc {
  _id: { toString(): string };
  title?: unknown;
  organisation?: unknown;
  lrs_id?: unknown;
  scopes?: unknown;
  [key: string]: unknown;
}

/** `req.user` après authentification : champs de l'utilisateur (ou du client) et `authInfo`. */
export interface AuthenticatedUser {
  authInfo?: AuthInfo;
  [key: string]: unknown;
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

const get = (value: unknown, path: string[]): unknown => {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

/** getAuthFromRequest : `req.user.authInfo || {}`. */
export const getAuthFromRequest = (req: AuthenticatedRequest): AuthInfo => req.user?.authInfo ?? {};

export const getTokenTypeFromAuthInfo = (authInfo: AuthInfo): unknown => get(authInfo, ['token', 'tokenType']);

export const getOrgFromAuthInfo = (authInfo: AuthInfo): unknown => {
  const tokenId = get(authInfo, ['token', 'tokenId']);
  const tokenType = getTokenTypeFromAuthInfo(authInfo);
  if (tokenType === 'organisation' || tokenType === 'worker') return tokenId;
  const tokenOrgId = get(authInfo, ['token', 'organisationId']);
  if (tokenOrgId) return tokenOrgId;
  const clientOrgId = get(authInfo, ['client', 'organisation']);
  if (clientOrgId) return clientOrgId;
  const dashboardOrgId = get(authInfo, ['token', 'organisation']);
  if (dashboardOrgId) return dashboardOrgId;
  return null;
};

export const getScopesFromAuthInfo = (authInfo: AuthInfo): unknown[] => {
  const tokenScopes = get(authInfo, ['token', 'scopes']);
  if (tokenScopes) return tokenScopes as unknown[];
  const clientScopes = get(authInfo, ['client', 'scopes']);
  if (clientScopes) return clientScopes as unknown[];
  return [];
};

export const getUserIdFromAuthInfo = (authInfo: AuthInfo): unknown => authInfo.user && authInfo.user._id;

export const getDashboardFromAuthInfo = (authInfo: AuthInfo): unknown => {
  const clientOrgId = get(authInfo, ['client', 'dashboard']);
  if (clientOrgId) return clientOrgId;
  const tokenId = get(authInfo, ['token', 'tokenId']);
  if (getTokenTypeFromAuthInfo(authInfo) === 'dashboard') return tokenId;
  return null;
};

export const getShareableFromAuthInfo = (authInfo: AuthInfo): unknown => {
  const shareableId = get(authInfo, ['token', 'shareableId']);
  if (getTokenTypeFromAuthInfo(authInfo) === 'dashboard') return shareableId;
  return null;
};

/** lodash.get(authInfo, ['token', 'filter'], {}) */
export const getFilterFromAuthInfo = (authInfo: AuthInfo): unknown => {
  const filter = get(authInfo, ['token', 'filter']);
  return filter === undefined ? {} : filter;
};
