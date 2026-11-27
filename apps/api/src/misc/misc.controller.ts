// Routes sans authentification : santé (`GET /` → OK), version, état de Google.
// Code d'origine : legacy/api/src/routes/HttpRoutes.js (routes '', VERSION, GOOGLE_AUTH, OAUTH2_FAILED).
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { parseBody } from '../http/body.js';
import { gitVersion } from './git-rev.js';

@Controller()
export class MiscController {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  // Le legacy analysait le corps de toute requête (JSON invalide → 400), routes sans corps comprises.

  @Get()
  async root(@Req() req: Request, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    res.status(200).send('OK');
  }

  @Get('app/version')
  async version(@Req() req: Request, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    try {
      res.status(200).json(await gitVersion());
    } catch (error) {
      // api/utils/responses.js : serverError → 500, message en texte.
      this.logger.error(error);
      res.status(500).send(error instanceof Error ? error.message : error);
    }
  }

  @Get('app/googleAuth')
  async googleAuth(@Req() req: Request, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    res.status(200).json({ enabled: this.config.googleEnabled });
  }

  @Get('oauth2/failed')
  async oauth2Failed(@Req() req: Request, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    res.send('Authorization failed');
  }
}
