// Outils de test : application complète sur une configuration de test, journal silencieux.
import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../app.js';
import { loadConfig, type ApiConfig } from '../config/config.js';
import { Logger } from '../core/logger.js';

export const TEST_SECRET = 'secret-de-test-0123456789';

/** Journal qui n'écrit rien (niveau inexistant au-dessous d'error). */
export class SilentLogger extends Logger {
  constructor() { super('error'); }
  override error(): void { /* silence */ }
}

/** URL MongoDB de test : base ll_test_* obligatoire (garde-fou), sinon les tests d'intégration sont sautés. */
export const mongoTestUrl = (): string | undefined => {
  const url = process.env.MONGO_TEST_URL;
  if (!url) return undefined;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.startsWith('ll_test_')) {
    throw new Error(`MONGO_TEST_URL doit désigner une base ll_test_* (reçu : « ${dbName} »)`);
  }
  return url;
};

export const testConfig = (env: Record<string, string | undefined> = {}): ApiConfig => loadConfig({
  NODE_ENV: 'production',
  APP_SECRET: TEST_SECRET,
  MONGODB_PATH: mongoTestUrl() ?? 'mongodb://127.0.0.1:9/ll_test_unused',
  REDIS_URL: process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:9/0',
  ...env,
});

/** Serveur HTTP de l'application (typé pour supertest). */
export const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;

export const createTestApp = async (env: Record<string, string | undefined> = {}): Promise<INestApplication> =>
  createApp(testConfig(env), new SilentLogger());
