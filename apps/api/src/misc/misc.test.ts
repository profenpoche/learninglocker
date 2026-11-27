import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, httpServer } from '../testing/app.js';

let app: INestApplication;
beforeAll(async () => { app = await createTestApp({ GOOGLE_ENABLED: 'false' }); });
afterAll(async () => { await app.close(); });

describe('routes sans authentification', () => {
  it('GET / → OK en text/html, avec CORS et en-têtes anti-cache', async () => {
    const res = await request(httpServer(app)).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    expect(res.headers.pragma).toBe('no-cache');
    expect(res.headers.expires).toBe('0');
  });

  it('GET /app/googleAuth lit GOOGLE_ENABLED comme un booléen (« false » → faux)', async () => {
    const res = await request(httpServer(app)).get('/app/googleAuth');
    expect(res.body).toEqual({ enabled: false });
  });

  it('GET /app/version renvoie les quatre champs (chaînes vides hors dépôt git)', async () => {
    const res = await request(httpServer(app)).get('/app/version');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object)).toEqual(['short', 'long', 'branch', 'tag']);
  });

  it('GET /oauth2/failed', async () => {
    const res = await request(httpServer(app)).get('/oauth2/failed');
    expect(res.text).toBe('Authorization failed');
  });

  it('les routes ne dépendent pas de la casse (Express)', async () => {
    const res = await request(httpServer(app)).get('/APP/GOOGLEAUTH');
    expect(res.status).toBe(200);
  });
});

describe('corps de requête', () => {
  it('un corps JSON invalide donne 400 (page d’erreur d’Express), même sur une route GET', async () => {
    const res = await request(httpServer(app)).get('/').set('Content-Type', 'application/json').send('{oups');
    expect(res.status).toBe(400);
    expect(res.text).toContain('<pre>Bad Request</pre>');
  });
});
