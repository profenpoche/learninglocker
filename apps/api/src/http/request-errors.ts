// Erreurs applicatives et leur rendu JSON `{ errorId, message }` (docs/03 §4.1).
// Codes d'origine : legacy/lib/errors/*.js et legacy/api/src/controllers/utils/{handleRequestError,catchErrors}.js.
//
// Les classes legacy héritaient d'un BaseError qui n'étendait pas Error ; ici elles étendent Error,
// mais le rendu est le même. Les erreurs de persona-service et de rulr seront ajoutées avec les
// routes qui les produisent.
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { Logger } from '../core/logger.js';

export class BaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ClientError extends BaseError {}

export class NotFoundError extends BaseError {
  constructor(modelName: string, modelId: string) {
    super(`Could not find ${modelName} with ${modelId}`);
  }
}

export class NoAccessError extends BaseError {
  constructor() {
    super('Priviliges not sufficient for this operation');
  }
}

/** Le message est toujours « Unauthorised » (le constructeur legacy ignorait son argument). */
export class Unauthorised extends BaseError {
  constructor() {
    super('Unauthorised');
  }
}

export class UnauthorisedQueryError extends BaseError {
  constructor() {
    super('The query requested was unauthorized');
  }
}

export class AlreadyProcessingError extends BaseError {
  constructor(modelName: string, modelId: string) {
    super(`${modelName} - ${modelId} cannot be processed in it's current state.`);
  }
}

export class RequestAppAccessError extends BaseError {
  constructor() {
    super('Access request failed');
  }
}

/** handleRequestError : statut selon la classe d'erreur, corps `{ errorId, message }`. */
export const handleRequestError = (res: Response, err: unknown, logger: Logger, logLevel = 'info'): void => {
  const errorId = randomUUID();
  const send = (status: number, message: string) => { res.status(status).send({ errorId, message }); };

  const status = err instanceof NotFoundError ? 404
    : err instanceof Unauthorised ? 401
      : err instanceof NoAccessError || err instanceof UnauthorisedQueryError ? 403
        : err instanceof ClientError ? 400
          : err instanceof AlreadyProcessingError ? 409
            : err instanceof RequestAppAccessError ? 500
              : undefined;
  if (status !== undefined) {
    send(status, (err as Error).message);
    return;
  }

  logger.error(errorId, err);
  if (err instanceof Error) {
    const body: { errorId: string; message: string; stack?: string } = { errorId, message: err.message };
    if (logLevel === 'debug' || logLevel === 'silly') body.stack = err.stack;
    res.status(500).send(body);
    return;
  }
  send(500, 'Error');
};

/** catchErrors : exécute un gestionnaire asynchrone et rend ses erreurs avec handleRequestError. */
export const catchErrors = async (res: Response, logger: Logger, logLevel: string, handler: () => Promise<void>): Promise<void> => {
  try {
    await handler();
  } catch (err) {
    handleRequestError(res, err, logger, logLevel);
  }
};
