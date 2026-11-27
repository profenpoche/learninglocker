// Connexion MongoDB (Mongoose 9, driver 7 : serveur MongoDB 4.4 au minimum).
// Code d'origine : legacy/lib/connections/mongoose.js (poolSize → maxPoolSize, socketTimeoutMS).
//
// L'API ne crée ni collection ni index : c'est le rôle des migrations (CLI, lot 6). Le legacy
// (Mongoose 5, autoIndex par défaut) créait les index des schémas au démarrage.
import mongoose, { type Connection } from 'mongoose';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';

export const createMongoConnection = (config: ApiConfig['mongo'], logger: Logger): Connection => {
  if (!config.url) throw new Error('MONGODB_PATH n’est pas défini.');
  const connection = mongoose.createConnection(config.url, {
    maxPoolSize: config.poolSize,
    socketTimeoutMS: config.socketTimeoutMS,
    autoIndex: false,
    autoCreate: false,
  });
  connection.on('error', (error: unknown) => {
    if (!(error instanceof Error && error.name === 'MongoTopologyClosedError')) logger.error('MongoDB :', error);
  });
  return connection;
};
