// Construction de l'application : Express 5 configuré comme l'API legacy (Express 4), puis NestJS.
// Code d'origine : legacy/api/src/server.js.
//
// Ordre des middlewares (legacy) : cors, analyseurs de corps, cookies, passport, puis le routeur
// (qui pose les en-têtes anti-cache). Ici, les analyseurs de corps ne sont pas globaux : ils sont
// appliqués route par route, pour que le relais transmette le corps intact à l'API legacy.
import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { AppModule } from './app.module.js';
import type { ApiConfig } from './config/config.js';
import type { Logger } from './core/logger.js';
import { ExpressErrorFilter } from './http/error.filter.js';
import { setNoCacheHeaders } from './http/no-cache.js';

/** Messages internes de NestJS (routes enregistrées…) : niveau verbose, pour ne pas encombrer les logs. */
const nestLogger = (logger: Logger): LoggerService => ({
  log: (message: unknown) => { logger.verbose(message); },
  error: (message: unknown, ...rest: unknown[]) => { logger.error(message, ...rest); },
  warn: (message: unknown) => { logger.warn(message); },
  debug: (message: unknown) => { logger.debug(message); },
  verbose: (message: unknown) => { logger.silly(message); },
});

export const createExpressServer = (): express.Express => {
  const server = express();
  // Express 4 utilisait par défaut l'analyseur « extended » (qs) ; Express 5 est passé à « simple ».
  server.set('query parser', 'extended');
  server.use(cors({ origin: '*', preflightContinue: true }));
  server.use(cookieParser());
  server.use(setNoCacheHeaders);
  return server;
};

export const createApp = async (config: ApiConfig, logger: Logger): Promise<INestApplication> => {
  const server = createExpressServer();
  const app = await NestFactory.create(AppModule.forRoot(config, logger), new ExpressAdapter(server), {
    bodyParser: false,
    logger: nestLogger(logger),
  });
  app.useGlobalFilters(new ExpressErrorFilter(config.nodeEnv, logger));
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  await app.init();
  return app;
};
