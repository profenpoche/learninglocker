// `passport.authenticate([...stratégies])` (passport 0.4.1) : les stratégies sont essayées dans
// l'ordre ; la première qui réussit l'emporte ; une erreur interrompt la chaîne.
// Code d'origine : node_modules/passport@0.4.1/lib/middleware/authenticate.js.
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth-info.js';
import type { Outcome, StrategyName, Strategies } from './strategies.js';

export interface ChainResult {
  user?: AuthenticatedUser;
  error?: unknown;
  failures: { challenge?: string; status?: number }[];
}

export const runChain = async (strategies: Strategies, names: readonly StrategyName[], req: Request): Promise<ChainResult> => {
  const failures: ChainResult['failures'] = [];
  for (const name of names) {
    const outcome: Outcome = await strategies.run(name, req);
    if (outcome.type === 'success') return { user: outcome.user, failures };
    if (outcome.type === 'error') return { error: outcome.error, failures };
    failures.push({ challenge: outcome.challenge, status: outcome.status });
  }
  return { failures };
};

/** Erreur à transmettre au gestionnaire d'erreurs d'Express (500 HTML). */
export class PassportError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
  }
}

/**
 * Mode par défaut (sans callback) : en cas d'échec, statut 401 (ou le premier statut d'échec),
 * en-têtes WWW-Authenticate des défis, corps « Unauthorized » sans Content-Type.
 * Renvoie l'utilisateur authentifié, ou null si la réponse est déjà envoyée.
 * Une erreur de stratégie est levée (gestionnaire d'erreurs d'Express : 500).
 */
export const authenticate = async (
  strategies: Strategies,
  names: readonly StrategyName[],
  req: AuthenticatedRequest,
  res: Response,
): Promise<AuthenticatedUser | null> => {
  const result = await runChain(strategies, names, req);
  if (result.error !== undefined) throw result.error instanceof Error ? result.error : new PassportError(result.error);
  if (result.user) {
    req.user = result.user;
    return result.user;
  }
  let status: number | undefined;
  const challenges: string[] = [];
  for (const failure of result.failures) {
    status = status || failure.status;
    if (typeof failure.challenge === 'string') challenges.push(failure.challenge);
  }
  res.statusCode = status || 401;
  if (res.statusCode === 401 && challenges.length) res.setHeader('WWW-Authenticate', challenges);
  res.end(STATUS_CODES[res.statusCode]);
  return null;
};

/**
 * Callback personnalisé des routes REST et connection (lib/constants/auth.js, HttpRoutes.js) :
 * erreur ou échec → 401 `text/plain` « Unauthorized », sans WWW-Authenticate.
 */
export const authenticateOr401 = async (
  strategies: Strategies,
  names: readonly StrategyName[],
  req: AuthenticatedRequest,
  res: Response,
): Promise<AuthenticatedUser | null> => {
  const result = await runChain(strategies, names, req);
  if (result.error !== undefined || !result.user) {
    res.status(401).set('Content-Type', 'text/plain').send('Unauthorized');
    return null;
  }
  req.user = result.user;
  return result.user;
};
