import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import mongoose, { type Connection } from 'mongoose';
import type { Redis } from 'ioredis';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { createRedisClient } from '../redis/redis.js';
import { createMongoConnection } from './connection.js';
import { createModels, type Models } from './models.js';

export const MONGO_CONNECTION = Symbol('MONGO_CONNECTION');
export const MODELS = Symbol('MODELS');
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: MONGO_CONNECTION,
      inject: [API_CONFIG, LOGGER],
      useFactory: (config: ApiConfig, logger: Logger): Connection => createMongoConnection(config.mongo, logger),
    },
    {
      provide: MODELS,
      inject: [MONGO_CONNECTION],
      useFactory: (connection: Connection): Models => createModels(connection),
    },
    {
      provide: REDIS,
      inject: [API_CONFIG, LOGGER],
      useFactory: (config: ApiConfig, logger: Logger): Redis => createRedisClient(config.redis, logger),
    },
  ],
  exports: [MONGO_CONNECTION, MODELS, REDIS],
})
export class DbModule implements OnApplicationShutdown {
  constructor(
    @Inject(MONGO_CONNECTION) private readonly connection: Connection,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
    // Pendant la connexion initiale, close() attendrait la fin de la sélection du serveur (30 s) :
    // on ferme d'abord le client du driver.
    if (this.connection.readyState === mongoose.ConnectionStates.connecting) await this.connection.getClient().close(true);
    await this.connection.close(true);
  }
}
