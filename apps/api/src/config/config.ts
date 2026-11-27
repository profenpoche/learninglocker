// Configuration de l'API : mêmes variables d'environnement, mêmes défauts et même sémantique que
// l'API legacy (docs/04-worker-cli-config.md §5.1). L'ancien fichier .env doit fonctionner tel quel.
// Lectures d'origine : legacy/api/src/server.js, legacy/lib/constants/auth.js, legacy/lib/connections/
// {mongoose,redis,nodemailer}.js, legacy/lib/logger.js, legacy/lib/helpers/{cachePrefix,email}.js,
// legacy/lib/services/auth/{canCreateOrganisations,modelFilters/organisation,modelFilters/batchDelete}.js,
// legacy/lib/models/plugins/addCRUDFunctions.js.
//
// Conventions reproduites :
// - `defaultTo(valeur, défaut)` de lodash : le défaut remplace undefined, null et NaN, mais pas '' ;
// - `boolean(x)` (paquet boolean 0.1.3) : vrai pour true, t, yes, y, 1 (casse ignorée) ;
// - `process.env.GOOGLE_ENABLED` est aussi testé comme chaîne (« false » est vrai) : les deux lectures existent.
import { parseBooleanEnv } from '@ll/shared';

type Env = Readonly<Record<string, string | undefined>>;

/** lodash.defaultTo */
const defaultTo = <T, D>(value: T, fallback: D): NonNullable<T> | D =>
  value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value)) ? fallback : value;

export interface RedisConfig {
  /** `redis` (défaut) ou `sentinel` (EVENTS_REPO). */
  mode: 'redis' | 'sentinel';
  /** REDIS_URL, prioritaire en mode redis. */
  url?: string;
  host?: string;
  port: number;
  db: number;
  password?: string;
  sentinelName: string;
  sentinels: { host: string; port: number }[];
  /** REDIS_PREFIX : préfixe des clés de cache (`<prefix>:<clé>`), aucun s'il est vide. */
  prefix?: string;
}

export interface ApiConfig {
  /** API_PORT : obligatoire (l'API legacy journalisait une erreur et n'écoutait pas). */
  port?: string;
  host?: string;
  nodeEnv?: string;
  appSecret?: string;
  siteUrl?: string;
  jwtAccessTokenExpiration: string;
  jwtRefreshTokenExpiration: string;
  /** Valeur brute de GOOGLE_ENABLED (test de vérité : la route Google existe si la chaîne est non vide). */
  googleEnabledRaw?: string;
  /** boolean(GOOGLE_ENABLED) : réponse de /app/googleAuth. */
  googleEnabled: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  enableStatementDeletion: boolean;
  restrictCreateOrganisation: boolean;
  /** MAX_TIME_MS de lib/models/plugins/addCRUDFunctions.js (`Number(x)` si défini, sinon 0). */
  maxTimeMS: number;
  mongo: {
    url?: string;
    poolSize: number;
    socketTimeoutMS: number;
  };
  redis: RedisConfig;
  log: {
    level: string;
    color: boolean;
  };
  mail: {
    testing: boolean;
    host?: string;
    port?: string;
    secure: boolean;
    ignoreTLS: boolean;
    requireTLS: boolean;
    authRequest: boolean;
    user?: string;
    pass?: string;
    fromName: string;
    fromEmail: string;
  };
  /** LEGACY_API_URL (nouvelle variable) : relais des routes non portées vers l'API legacy. */
  legacyApiUrl?: string;
}

const DEFAULT_REDIS_PORT = 6379;

const readRedis = (env: Env): RedisConfig => {
  const mode = defaultTo(env.EVENTS_REPO, 'redis') === 'sentinel' ? 'sentinel' : 'redis';
  const connections = defaultTo(env.SENTINEL_CONNECTIONS, '127.0.0.1:6379');
  const sentinels = connections.split(' ').map((conn) => {
    const [host = '', port] = conn.split(':');
    return { host, port: defaultTo(Number(port), DEFAULT_REDIS_PORT) };
  });
  return mode === 'sentinel'
    ? {
      mode,
      db: defaultTo(Number(env.SENTINEL_DB), 0),
      password: env.SENTINEL_PASSWORD,
      sentinelName: defaultTo(env.SENTINEL_NAME, 'mymaster'),
      sentinels,
      port: DEFAULT_REDIS_PORT,
      prefix: env.REDIS_PREFIX || undefined,
    }
    : {
      mode,
      url: env.REDIS_URL || undefined,
      db: defaultTo(Number(env.REDIS_DB), 0),
      password: env.REDIS_PASSWORD,
      host: env.REDIS_HOST,
      port: defaultTo(Number(env.REDIS_PORT), DEFAULT_REDIS_PORT),
      sentinelName: 'mymaster',
      sentinels: [],
      prefix: env.REDIS_PREFIX || undefined,
    };
};

export const loadConfig = (env: Env = process.env): ApiConfig => ({
  port: env.API_PORT,
  host: env.API_HOST,
  nodeEnv: env.NODE_ENV,
  appSecret: env.APP_SECRET,
  siteUrl: env.SITE_URL,
  jwtAccessTokenExpiration: defaultTo(env.JWT_ACCESS_TOKEN_EXPIRATION, '1h'),
  jwtRefreshTokenExpiration: defaultTo(env.JWT_REFRESH_TOKEN_EXPIRATION, '7d'),
  googleEnabledRaw: env.GOOGLE_ENABLED,
  googleEnabled: parseBooleanEnv(env.GOOGLE_ENABLED),
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  // lodash.get(process.env, 'ENABLE_STATEMENT_DELETION', true) : défaut seulement si absente.
  enableStatementDeletion: parseBooleanEnv(env.ENABLE_STATEMENT_DELETION === undefined ? true : env.ENABLE_STATEMENT_DELETION),
  restrictCreateOrganisation: parseBooleanEnv(defaultTo(env.RESTRICT_CREATE_ORGANISATION, true)),
  maxTimeMS: env.MAX_TIME_MS ? Number(env.MAX_TIME_MS) : 0,
  mongo: {
    url: env.MONGODB_PATH,
    poolSize: defaultTo(Number(env.MONGO_CONNECTION_POOLSIZE), 20),
    socketTimeoutMS: defaultTo(Number(env.MONGO_SOCKET_TIMEOUT_MS), 300000),
  },
  redis: readRedis(env),
  log: {
    level: defaultTo(env.LOG_MIN_LEVEL, 'info'),
    color: parseBooleanEnv(env.COLOR_LOGS),
  },
  mail: {
    testing: Boolean(env.TESTING),
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: parseBooleanEnv(defaultTo(env.SMTP_SECURED, false)),
    ignoreTLS: parseBooleanEnv(defaultTo(env.SMTP_IGNORE_TLS, false)),
    requireTLS: parseBooleanEnv(defaultTo(env.SMTP_REQUIRE_TLS, false)),
    authRequest: parseBooleanEnv(defaultTo(env.SMTP_AUTH_REQUEST, true)),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    fromName: defaultTo(env.LL_FROM_NAME, 'Learning Locker'),
    fromEmail: defaultTo(env.LL_FROM_EMAIL, 'noreply@learninglocker.net'),
  },
  legacyApiUrl: env.LEGACY_API_URL || undefined,
});

/**
 * Fonctionnalités reportées (décision D2) : le démarrage échoue avec un message clair plutôt que de
 * fonctionner à moitié. Renvoie la liste des problèmes (vide si la configuration est acceptée).
 */
export const unsupportedSettings = (env: Env = process.env): string[] => {
  const problems: string[] = [];
  const fsRepo = env.FS_REPO;
  if (fsRepo && fsRepo !== 'local') problems.push(`FS_REPO=${fsRepo} : seul le stockage local est pris en charge (D2).`);
  const queue = env.QUEUE_PROVIDER;
  if (queue && !['REDIS', 'BULL'].includes(queue)) problems.push(`QUEUE_PROVIDER=${queue} : seules les files Redis sont prises en charge (D2).`);
  if (env.NEW_RELIC_LICENSE_KEY) problems.push('NEW_RELIC_LICENSE_KEY : New Relic n’est pas pris en charge (D2).');
  if (parseBooleanEnv(env.WINSTON_CLOUDWATCH_ENABLED)) problems.push('WINSTON_CLOUDWATCH_ENABLED : CloudWatch n’est pas pris en charge (D2).');
  return problems;
};
