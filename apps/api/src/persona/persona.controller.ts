// GET /v2/persona/count : nombre de personas de l'organisation (paramètre `query` en JSON).
// Codes d'origine : legacy/api/src/controllers/PersonaController.js (personaCount),
// node_modules/@learninglocker/persona-service@1.7.1/dist/mongoModelsRepo/getPersonaCount.js.
// Les autres routes des personas passent par le relais.
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { getAuthFromRequest, getOrgFromAuthInfo, type AuthenticatedRequest } from '../auth/auth-info.js';
import { authenticate } from '../auth/passport.js';
import type { Strategies } from '../auth/strategies.js';
import { STRATEGIES } from '../auth/tokens.js';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { MONGO_CONNECTION } from '../db/db.module.js';
import { parseBody } from '../http/body.js';
import { catchErrors } from '../http/request-errors.js';
import { SCOPES } from '../scopes/scope.module.js';
import { legacyObjectId, type ScopeService } from '../scopes/scope.service.js';
import type { Connection } from 'mongoose';

@Controller()
export class PersonaController {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(MONGO_CONNECTION) private readonly connection: Connection,
    @Inject(STRATEGIES) private readonly strategies: Strategies,
    @Inject(SCOPES) private readonly scopes: ScopeService,
  ) {}

  @Get('v2/persona/count')
  async count(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const user = await authenticate(this.strategies, ['jwt', 'clientBasic'], req, res);
    if (!user) return;
    await catchErrors(res, this.logger, this.config.log.level, async () => {
      const authInfo = getAuthFromRequest(req);
      const scopeFilter = await this.scopes.getScopeFilter({ modelName: 'persona', actionName: 'view', authInfo });
      const userFilter = await this.scopes.parseQuery((req.query as Record<string, unknown>).query, authInfo);
      const filter = { ...(userFilter as object), ...(scopeFilter as object) };
      // persona-service : `new ObjectID(organisation)` (nouvel identifiant si l'organisation est absente).
      const organisation = legacyObjectId(getOrgFromAuthInfo(authInfo));
      const count = await this.connection.collection('personas').countDocuments({ ...filter, organisation });
      res.status(200).send({ count });
    });
  }
}
