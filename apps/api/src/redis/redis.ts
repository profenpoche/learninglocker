// Client Redis (ioredis), mêmes options que l'API legacy : REDIS_URL prioritaire, sinon hôte, port,
// base et mot de passe ; mode sentinel si EVENTS_REPO=sentinel.
// Code d'origine : legacy/lib/connections/redis.js et legacy/lib/helpers/cachePrefix.js.
import { Redis } from 'ioredis';
import type { RedisConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';

export const createRedisClient = (config: RedisConfig, logger: Logger): Redis => {
  logger.info('Creating Redis client');
  const client = config.mode === 'sentinel'
    ? new Redis({ db: config.db, password: config.password, name: config.sentinelName, sentinels: config.sentinels, lazyConnect: true })
    : config.url
      ? new Redis(config.url, { lazyConnect: true })
      : new Redis({ db: config.db, password: config.password, host: config.host, port: config.port, lazyConnect: true });
  client.on('error', (error: unknown) => { logger.error('Redis :', error); });
  client.connect().catch(() => { /* erreur déjà journalisée ; ioredis se reconnecte */ });
  return client;
};

/** `cachePrefix` : `<REDIS_PREFIX>:<clé>`, ou la clé seule sans préfixe. */
export const cachePrefix = (prefix: string | undefined, key: string): string => (prefix ? `${prefix}:${key}` : key);
