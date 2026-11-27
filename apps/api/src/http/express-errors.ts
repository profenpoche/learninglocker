// Réponses d'erreur par défaut d'Express (finalhandler), comme dans l'API legacy qui n'avait ni
// gestionnaire d'erreurs global ni 404 JSON (docs/03 §1.1) : page HTML « Cannot GET /chemin » pour
// une route inconnue, page HTML avec le libellé du statut pour une erreur (NODE_ENV=production).
// Code d'origine : legacy/api/src/server.js (absence de gestionnaire), express 4.17 / finalhandler 1.1.2.
import type { IncomingMessage, ServerResponse } from 'node:http';
import finalhandler from 'finalhandler';

export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  headers?: Record<string, string>;
}

/** `app.get('env')` d'Express : NODE_ENV, sinon « development ». */
const expressEnv = (nodeEnv: string | undefined): string => nodeEnv ?? 'development';

/** Réponse d'une route inconnue (404 HTML d'Express). */
export const sendNotFound = (req: IncomingMessage, res: ServerResponse, nodeEnv?: string): void => {
  finalhandler(req, res, { env: expressEnv(nodeEnv) })(undefined);
};

/** Réponse d'une erreur non gérée, transmise à `next(err)` dans le code legacy. */
export const sendExpressError = (
  req: IncomingMessage,
  res: ServerResponse,
  error: unknown,
  nodeEnv?: string,
  onError?: (error: unknown) => void,
): void => {
  finalhandler(req, res, { env: expressEnv(nodeEnv), onerror: (err: unknown) => onError?.(err) })(error);
};
