// Route attrape-tout, enregistrée après toutes les routes portées : relais vers l'API legacy si
// LEGACY_API_URL est défini, sinon réponse d'une route inconnue de l'API legacy (404 HTML d'Express).
import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { sendNotFound } from '../http/express-errors.js';
import { createRelay } from './relay.js';

@Controller()
export class RelayController {
  private readonly relay: ReturnType<typeof createRelay> | null;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.relay = config.legacyApiUrl
      ? createRelay({ target: config.legacyApiUrl, onError: (error) => { logger.error('Relais vers l’API legacy :', error.message); } })
      : null;
  }

  @All('{*path}')
  handle(@Req() req: Request, @Res() res: Response): void {
    if (this.relay) this.relay(req, res);
    else sendNotFound(req, res, this.config.nodeEnv);
  }
}
