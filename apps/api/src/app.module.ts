import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiConfig } from './config/config.js';
import type { Logger } from './core/logger.js';
import { API_CONFIG, LOGGER } from './core/tokens.js';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { MiscController } from './misc/misc.controller.js';
import { RelayModule } from './relay/relay.module.js';
import { RestModule } from './rest/rest.module.js';
import { ScopeModule } from './scopes/scope.module.js';

@Global()
@Module({})
class CoreModule {
  static forRoot(config: ApiConfig, logger: Logger): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: LOGGER, useValue: logger },
      ],
      exports: [API_CONFIG, LOGGER],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(config: ApiConfig, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config, logger),
        DbModule,
        AuthModule,
        ScopeModule,
        RestModule,
        // Toujours en dernier : route attrape-tout (relais ou 404).
        RelayModule,
      ],
      controllers: [MiscController],
    };
  }
}
