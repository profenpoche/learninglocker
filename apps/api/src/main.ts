// Point d'entrée de l'API 2026 : lit .env (comme dotenv 2 dans le bundle legacy), vérifie la
// configuration, démarre NestJS et écoute sur API_PORT (toutes les interfaces).
// Code d'origine : legacy/api/src/server.js.
import 'reflect-metadata';
import { createApp } from './app.js';
import { loadConfig, unsupportedSettings } from './config/config.js';
import { loadEnvFile } from './config/env-file.js';
import { Logger } from './core/logger.js';

loadEnvFile('.env');
const config = loadConfig();
const logger = new Logger(config.log.level, config.log.color);

const problems = unsupportedSettings();
if (problems.length) {
  for (const problem of problems) logger.error(problem);
  process.exit(1);
}
if (!config.port) {
  // Message de l'API legacy, qui restait alors démarrée sans écouter : ici, on s'arrête.
  logger.error('==>     ERROR: No PORT environment variable has been specified');
  process.exit(1);
}

const app = await createApp(config, logger);
await app.listen(config.port);
logger.info(
  `==> API is running on port ${config.port}`,
  `==> Send requests to http://${config.host ?? ''}:${config.port}`,
  config.legacyApiUrl ? `==> Routes non portées relayées vers ${config.legacyApiUrl}` : '',
);
