// GET /statements/count : nombre de statements visibles (filtre JSON `filter` ou `query`).
// Codes d'origine : legacy/api/src/controllers/StatementController.js (countStatements),
// legacy/lib/services/statements/countStatements.js, legacy/lib/models/plugins/addCRUDFunctions.js (getCount).
// Les agrégations (/statements/aggregate…) ne sont pas encore portées : elles passent par le relais.
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { getAuthFromRequest, type AuthenticatedRequest } from '../auth/auth-info.js';
import { authenticate } from '../auth/passport.js';
import type { Strategies } from '../auth/strategies.js';
import { STRATEGIES } from '../auth/tokens.js';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { MODELS } from '../db/db.module.js';
import type { Models } from '../db/models.js';
import { parseJsonLegacy } from '../http/legacy-json.js';
import { parseBody } from '../http/body.js';
import { catchErrors } from '../http/request-errors.js';
import { getCount } from '../rest/connection.js';
import { SCOPES } from '../scopes/scope.module.js';
import type { ScopeService } from '../scopes/scope.service.js';

@Controller()
export class StatementsController {
  /** MAX_TIME_MS du contrôleur : `defaultTo(Number(process.env.MAX_TIME_MS), 0)`. */
  private readonly maxTimeMS: number;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(MODELS) private readonly models: Models,
    @Inject(STRATEGIES) private readonly strategies: Strategies,
    @Inject(SCOPES) private readonly scopes: ScopeService,
  ) {
    this.maxTimeMS = Number.isNaN(config.maxTimeMS) ? 0 : config.maxTimeMS;
  }

  @Get('statements/count')
  async count(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const user = await authenticate(this.strategies, ['jwt', 'clientBasic'], req, res);
    if (!user) return;
    await catchErrors(res, this.logger, this.config.log.level, async () => {
      const query = req.query as Record<string, unknown>;
      const json = (key: string, defaultValue: unknown) => (key in query ? parseJsonLegacy(query[key]) : defaultValue);
      // Comme le legacy, `query` est lu (et doit être du JSON valide) même si `filter` est fourni.
      const fallback = json('query', {});
      const filter = json('filter', fallback);
      const maxTimeMS = 'maxTimeMS' in query ? Number(query.maxTimeMS) : this.maxTimeMS;
      const hint = json('hint', null);
      const authInfo = getAuthFromRequest(req);
      const parsedFilter = await this.scopes.parseQuery(filter, authInfo);
      const count = await getCount(this.scopes, { model: this.models.Statement, lrs: this.models.Lrs }, { filter: parsedFilter, authInfo, maxTimeMS, hint });
      res.status(200).send({ count });
    });
  }
}
