// En-têtes anti-cache posés sur toutes les réponses de l'API.
// Code d'origine : legacy/lib/constants/auth.js (setNoCacheHeaders), monté par legacy/api/src/routes/HttpRoutes.js.
import type { NextFunction, Request, Response } from 'express';

export const setNoCacheHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  next();
};
