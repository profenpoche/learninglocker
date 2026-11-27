import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, httpServer } from '../testing/app.js';

// API legacy factice : renvoie ce qu'elle a reçu.
let upstream: Server;
let upstreamUrl: string;
let app: INestApplication;
let appWithoutRelay: INestApplication;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url?.startsWith('/never')) return;
      if (req.url?.startsWith('/binary')) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from([0, 1, 2, 255]));
        return;
      }
      res.setHeader('Set-Cookie', ['a=1; Path=/api', 'b=2; HttpOnly']);
      res.setHeader('WWW-Authenticate', ['Bearer realm="Users"', 'Basic realm="Users"']);
      res.writeHead(418, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('base64') }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${String((upstream.address() as AddressInfo).port)}`;
  app = await createTestApp({ LEGACY_API_URL: upstreamUrl });
  appWithoutRelay = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await appWithoutRelay.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

describe('relais vers l’API legacy', () => {
  it('transmet méthode, chemin, query string, en-têtes et corps intacts', async () => {
    const res = await request(httpServer(app))
      .post('/v2/lrs/abc?x[a]=1&y=%C3%A9')
      .set('Content-Type', 'application/json')
      .set('Cookie', 'access_token_user_1=t')
      .set('Authorization', 'Bearer xyz')
      .send('{"title":"é"}');
    expect(res.status).toBe(418);
    const echoed = JSON.parse(res.text) as { method: string; url: string; headers: Record<string, string>; body: string };
    expect(echoed.method).toBe('POST');
    expect(echoed.url).toBe('/v2/lrs/abc?x[a]=1&y=%C3%A9');
    expect(echoed.headers.cookie).toBe('access_token_user_1=t');
    expect(echoed.headers.authorization).toBe('Bearer xyz');
    expect(Buffer.from(echoed.body, 'base64').toString()).toBe('{"title":"é"}');
  });

  it('recopie statut et en-têtes (Set-Cookie multiples, WWW-Authenticate), sans en-têtes ajoutés par l’API 2026', async () => {
    const res = await request(httpServer(app)).get('/inconnue');
    expect(res.status).toBe(418);
    expect(res.headers['set-cookie']).toEqual(['a=1; Path=/api', 'b=2; HttpOnly']);
    expect(res.headers['www-authenticate']).toBe('Bearer realm="Users", Basic realm="Users"');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it('transmet un corps multipart et un corps binaire', async () => {
    const res = await request(httpServer(app)).post('/uploadlogo').attach('file', Buffer.from([1, 2, 3]), 'logo.png');
    const echoed = JSON.parse(res.text) as { headers: Record<string, string>; body: string };
    expect(echoed.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(Buffer.from(echoed.body, 'base64').includes(Buffer.from([1, 2, 3]))).toBe(true);
    const bin = await request(httpServer(app)).get('/binary').buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on('data', (c: Buffer) => parts.push(c));
      r.on('end', () => { cb(null, Buffer.concat(parts)); });
    });
    expect(bin.headers['content-type']).toBe('image/png');
    expect(bin.body).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it('annule la requête amont si le client abandonne', async () => {
    await expect(request(httpServer(app)).get('/never').timeout(300)).rejects.toThrow(/Timeout/);
  });

  it('502 si l’API legacy est injoignable', async () => {
    const broken = await createTestApp({ LEGACY_API_URL: 'http://127.0.0.1:9' });
    const res = await request(httpServer(broken)).get('/inconnue');
    expect(res.status).toBe(502);
    await broken.close();
  });
});

describe('sans relais', () => {
  it('une route non portée répond comme une route inconnue du legacy (404 HTML d’Express)', async () => {
    const res = await request(httpServer(appWithoutRelay)).get('/route-inexistante');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.text).toBe('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /route-inexistante</pre>\n</body>\n</html>\n');
  });
});
