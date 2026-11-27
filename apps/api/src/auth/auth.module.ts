import { Global, Module } from '@nestjs/common';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { MODELS } from '../db/db.module.js';
import type { Models } from '../db/models.js';
import { Mailer } from '../mail/mailer.js';
import { AuthController } from './auth.controller.js';
import { JwtService } from './jwt.js';
import { Strategies } from './strategies.js';
import { JWT, MAILER, STRATEGIES } from './tokens.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: JWT,
      inject: [API_CONFIG, MODELS],
      useFactory: (config: ApiConfig, models: Models) =>
        new JwtService(config.appSecret, config.jwtAccessTokenExpiration, config.jwtRefreshTokenExpiration, models),
    },
    {
      provide: STRATEGIES,
      inject: [MODELS, JWT, LOGGER],
      useFactory: (models: Models, jwt: JwtService, logger: Logger) => new Strategies(models, jwt, logger),
    },
    {
      provide: MAILER,
      inject: [API_CONFIG, LOGGER],
      useFactory: (config: ApiConfig, logger: Logger) => new Mailer(config.mail, config.siteUrl, logger),
    },
  ],
  exports: [JWT, STRATEGIES, MAILER],
})
export class AuthModule {}
