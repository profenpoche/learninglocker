// Analyse du corps des requêtes, comme `bodyParser.json({ limit: '5mb' })` puis
// `bodyParser.urlencoded({ extended: false })` dans l'API legacy (legacy/api/src/server.js).
// Elle n'est appliquée qu'aux routes portées : le relais doit transmettre le corps intact.
// Une erreur (JSON invalide, corps trop gros) suit le chemin d'erreur d'Express (400/413 HTML).
import express, { type Request, type Response } from 'express';

const json = express.json({ limit: '5mb' });
const urlencoded = express.urlencoded({ extended: false });

export const parseBody = (req: Request, res: Response): Promise<void> => new Promise((resolve, reject) => {
  json(req, res, (jsonError?: unknown) => {
    if (jsonError) {
      reject(jsonError instanceof Error ? jsonError : new Error('Body parser error'));
      return;
    }
    urlencoded(req, res, (formError?: unknown) => {
      if (formError) {
        reject(formError instanceof Error ? formError : new Error('Body parser error'));
        return;
      }
      // body-parser 1 initialisait toujours req.body à {} ; body-parser 2 le laisse indéfini sans corps.
      req.body ??= {};
      resolve();
    });
  });
});
