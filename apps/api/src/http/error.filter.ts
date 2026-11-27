// Filtre global : toute exception non traitée par une route portée est rendue comme le faisait
// Express 4 dans l'API legacy (page HTML de finalhandler, statut de l'erreur ou 500).
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from '../core/logger.js';
import { sendExpressError, type HttpError } from './express-errors.js';

@Catch()
export class ExpressErrorFilter implements ExceptionFilter {
  constructor(private readonly nodeEnv: string | undefined, private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) {
      this.logger.error(exception);
      res.destroy();
      return;
    }
    let error: unknown = exception;
    if (exception instanceof HttpException) {
      error = Object.assign(new Error(exception.message), { status: exception.getStatus() }) satisfies HttpError;
    }
    sendExpressError(req, res, error, this.nodeEnv, (err) => { this.logger.error(err); });
  }
}
