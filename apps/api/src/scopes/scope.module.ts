import { Global, Module } from '@nestjs/common';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { MODELS } from '../db/db.module.js';
import type { Models } from '../db/models.js';
import { ScopeService } from './scope.service.js';

export const SCOPES = Symbol('SCOPES');

@Global()
@Module({
  providers: [{
    provide: SCOPES,
    inject: [MODELS, API_CONFIG, LOGGER],
    useFactory: (models: Models, config: ApiConfig, logger: Logger) => new ScopeService(models, config, logger),
  }],
  exports: [SCOPES],
})
export class ScopeModule {}
