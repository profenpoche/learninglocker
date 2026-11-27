import { describe, expect, it } from 'vitest';
import { loadConfig, unsupportedSettings } from './config.js';

describe('loadConfig', () => {
  it('applique les défauts legacy', () => {
    const config = loadConfig({});
    expect(config.jwtAccessTokenExpiration).toBe('1h');
    expect(config.jwtRefreshTokenExpiration).toBe('7d');
    expect(config.enableStatementDeletion).toBe(true);
    expect(config.restrictCreateOrganisation).toBe(true);
    expect(config.googleEnabled).toBe(false);
    expect(config.maxTimeMS).toBe(0);
    expect(config.mongo).toEqual({ url: undefined, poolSize: 20, socketTimeoutMS: 300000 });
    expect(config.redis).toMatchObject({ mode: 'redis', db: 0, port: 6379, prefix: undefined });
    expect(config.log).toEqual({ level: 'info', color: false });
    expect(config.mail.fromName).toBe('Learning Locker');
    expect(config.legacyApiUrl).toBeUndefined();
  });

  it('lit les booléens comme le paquet boolean 0.1.3', () => {
    expect(loadConfig({ GOOGLE_ENABLED: 'false' }).googleEnabled).toBe(false);
    expect(loadConfig({ GOOGLE_ENABLED: 'false' }).googleEnabledRaw).toBe('false');
    expect(loadConfig({ GOOGLE_ENABLED: 'Yes' }).googleEnabled).toBe(true);
    expect(loadConfig({ ENABLE_STATEMENT_DELETION: '' }).enableStatementDeletion).toBe(false);
    expect(loadConfig({ ENABLE_STATEMENT_DELETION: '0' }).enableStatementDeletion).toBe(false);
    expect(loadConfig({ RESTRICT_CREATE_ORGANISATION: 'no' }).restrictCreateOrganisation).toBe(false);
    expect(loadConfig({ COLOR_LOGS: 'true' }).log.color).toBe(true);
  });

  it('lodash.defaultTo : une chaîne vide n’est pas remplacée, NaN l’est', () => {
    expect(loadConfig({ JWT_ACCESS_TOKEN_EXPIRATION: '' }).jwtAccessTokenExpiration).toBe('');
    expect(loadConfig({ MONGO_CONNECTION_POOLSIZE: 'abc' }).mongo.poolSize).toBe(20);
    expect(loadConfig({ REDIS_DB: '3' }).redis.db).toBe(3);
  });

  it('REDIS_URL est prioritaire ; le mode sentinel lit SENTINEL_*', () => {
    expect(loadConfig({ REDIS_URL: 'redis://r:6379/1' }).redis.url).toBe('redis://r:6379/1');
    expect(loadConfig({ EVENTS_REPO: 'sentinel', SENTINEL_CONNECTIONS: 'a:1 b' }).redis).toMatchObject({
      mode: 'sentinel', sentinelName: 'mymaster', sentinels: [{ host: 'a', port: 1 }, { host: 'b', port: 6379 }],
    });
  });
});

describe('unsupportedSettings (D2)', () => {
  it('accepte la configuration Redis + stockage local', () => {
    expect(unsupportedSettings({ FS_REPO: 'local', QUEUE_PROVIDER: 'REDIS' })).toEqual([]);
  });
  it('refuse les fournisseurs reportés', () => {
    expect(unsupportedSettings({ FS_REPO: 'amazon', QUEUE_PROVIDER: 'SQS', NEW_RELIC_LICENSE_KEY: 'x', WINSTON_CLOUDWATCH_ENABLED: 'true' })).toHaveLength(4);
  });
});
