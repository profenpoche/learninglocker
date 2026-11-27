// Tests d'intégration de l'authentification (MongoDB requis : MONGO_TEST_URL, base ll_test_*).
// Inspirés de legacy/api/src/routes/tests/http-test.js.
import jsonwebtoken from 'jsonwebtoken';
import type { Connection } from 'mongoose';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, httpServer, mongoTestUrl, TEST_SECRET } from '../testing/app.js';
import { basic, CLIENT, IDS, openTestDb, PASSWORD, seed } from '../testing/db.js';

const enabled = Boolean(mongoTestUrl());
let app: INestApplication;
let db: Connection;
const decode = (token: string) => jsonwebtoken.verify(token, TEST_SECRET) as Record<string, unknown>;
const http = () => request(httpServer(app));

describe.runIf(enabled)('authentification', () => {
  beforeAll(async () => {
    db = await openTestDb();
    app = await createTestApp({ TESTING: 'true' });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await db.dropDatabase();
    await seed(db);
  });

  const login = () => http().post('/auth/jwt/password').set('Authorization', basic('testy@mctestface.com', PASSWORD));

  describe('POST /auth/jwt/password', () => {
    it('renvoie le JWT utilisateur en text/plain et pose le cookie de refresh', async () => {
      const res = await login().expect(200).expect('Content-Type', 'text/plain; charset=utf-8');
      const [header, payload] = res.text.split('.');
      expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
      // Ordre des revendications du legacy (filter absent car indéfini).
      expect(Object.keys(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as object))
        .toEqual(['userId', 'provider', 'scopes', 'tokenType', 'tokenId', 'shareableId', 'extensions', 'organisation', 'iat', 'exp']);
      const claims = decode(res.text);
      expect(claims).toMatchObject({ userId: String(IDS.user), provider: 'native', scopes: ['site_admin'], tokenType: 'user', tokenId: String(IDS.user), shareableId: null, extensions: {}, organisation: null });
      expect((claims.exp as number) - (claims.iat as number)).toBe(3600);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(1);
      const [pair = '', ...attributes] = (cookies[0] ?? '').split('; ');
      expect(pair.startsWith(`refresh_token_user_${String(IDS.user)}=`)).toBe(true);
      expect(attributes.sort()).toEqual(expect.arrayContaining(['HttpOnly', 'Max-Age=604800', 'Path=/api/auth/jwt/refresh', 'SameSite=Strict']));
      expect(attributes.some((a) => a.startsWith('Expires='))).toBe(true);
      expect(attributes).not.toContain('Secure');
      const refresh = decode(pair.split('=')[1] ?? '');
      expect(refresh).toMatchObject({ tokenType: 'user_refresh', scopes: ['refresh_token_user'] });
      expect((refresh.exp as number) - (refresh.iat as number)).toBe(604800);

      const user = await db.collection('users').findOne({ _id: IDS.user });
      expect(user?.authFailedAttempts).toBe(0);
      expect(user?.authLastAttempt).toBeInstanceOf(Date);
      expect((user?.updatedAt as Date).getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
    });

    it('accepte l’email en majuscules (setter lowercase de Mongoose)', async () => {
      await http().post('/auth/jwt/password').set('Authorization', basic('TESTY@MCTESTFACE.COM', PASSWORD)).expect(200);
    });

    it('401 JSON sans WWW-Authenticate pour un mauvais mot de passe, puis verrouillage', async () => {
      for (let i = 0; i < 3; i += 1) {
        const res = await http().post('/auth/jwt/password').set('Authorization', basic('testy@mctestface.com', 'mauvais')).expect(401);
        expect(res.body).toEqual({ success: false, message: 'Incorrect login details' });
        expect(res.headers['www-authenticate']).toBeUndefined();
      }
      const user = await db.collection('users').findOne({ _id: IDS.user });
      expect(user?.authFailedAttempts).toBe(3);
      expect(user?.authLockoutExpiry).toBeInstanceOf(Date);
      // Verrouillé : même le bon mot de passe est refusé.
      await login().expect(401);
    });

    it('utilisateur inconnu, en-tête absent', async () => {
      const unknown = await http().post('/auth/jwt/password').set('Authorization', basic('x@y.z', 'abc')).expect(401);
      expect(unknown.body).toEqual({ success: false, message: 'Incorrect login details' });
      const none = await http().post('/auth/jwt/password').expect(401);
      expect(none.body).toEqual({ success: false, message: 'There was an error (code: undefined)' });
    });
  });

  describe('POST /auth/jwt/organisation et /auth/jwt/refresh', () => {
    it('JWT d’organisation : scopes des rôles (sans doublon) puis scopes du site, filtre parsé', async () => {
      const userToken = (await login()).text;
      const res = await http().post('/auth/jwt/organisation').set('Authorization', `Bearer ${userToken}`).send({ organisation: String(IDS.org) }).expect(200);
      const claims = decode(res.text);
      expect(claims).toMatchObject({ tokenType: 'organisation', tokenId: String(IDS.org), scopes: ['all', 'org/public/dashboard/view', 'org/public/visualisation/view', 'site_admin'], filter: {} });
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
      expect(cookie.startsWith(`refresh_token_organisation_${String(IDS.org)}=`)).toBe(true);

      const refreshed = await http().post('/auth/jwt/refresh').set('Cookie', cookie.split(';')[0] ?? '').send({ tokenType: 'organisation', id: String(IDS.org) }).expect(200);
      expect(decode(refreshed.text)).toMatchObject({ tokenType: 'organisation', tokenId: String(IDS.org) });
    });

    it('401 texte si l’utilisateur n’est pas membre ; 401 avec défi Bearer sans jeton', async () => {
      const userToken = (await login()).text;
      const res = await http().post('/auth/jwt/organisation').set('Authorization', `Bearer ${userToken}`).send({ organisation: String(IDS.otherOrg) }).expect(401);
      expect(res.text).toBe('User does not have access to this organisation.');
      const none = await http().post('/auth/jwt/organisation').send({ organisation: String(IDS.org) }).expect(401);
      expect(none.headers['www-authenticate']).toBe('Bearer realm="Users"');
      expect(none.text).toBe('Unauthorized');
    });

    it('refresh sans cookie ou avec un cookie invalide → 401 { errorId, message }', async () => {
      const res = await http().post('/auth/jwt/refresh').send({ tokenType: 'user', id: String(IDS.user) }).expect(401);
      expect(res.body).toMatchObject({ message: 'Unauthorised' });
      expect(res.body).toHaveProperty('errorId');
      await http().post('/auth/jwt/refresh').set('Cookie', `refresh_token_user_${String(IDS.user)}=abc`).send({ tokenType: 'user', id: String(IDS.user) }).expect(401);
    });

    it('un jeton dont les scopes ne correspondent plus à la base est refusé (régénération de la charge)', async () => {
      const userToken = (await login()).text;
      await db.collection('users').updateOne({ _id: IDS.user }, { $set: { scopes: [] } });
      await http().get('/auth/jwt/success').query({ access_token: userToken }).expect(500);
    });

    it('jeton expiré ou mal signé → 401 avec défi invalid_token', async () => {
      const expired = jsonwebtoken.sign({ userId: String(IDS.user), exp: 1 }, TEST_SECRET);
      const res = await http().get('/auth/jwt/success').set('Authorization', `Bearer ${expired}`).expect(401);
      expect(res.headers['www-authenticate']).toBe('Bearer realm="Users", error="invalid_token"');
      const forged = jsonwebtoken.sign({ userId: String(IDS.user) }, 'autre-secret');
      await http().get('/auth/jwt/success').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('GET /auth/jwt/success avec ?access_token=', async () => {
      const userToken = (await login()).text;
      const res = await http().get('/auth/jwt/success').query({ access_token: userToken }).expect(200);
      expect(res.text).toBe('Login success!');
    });
  });

  describe('clients API', () => {
    it('GET /auth/client/info', async () => {
      const res = await http().get('/auth/client/info').set('Authorization', basic(CLIENT.key, CLIENT.secret)).expect(200);
      expect(res.body).toEqual({ title: 'Client', organisation: String(IDS.org), lrs_id: String(IDS.lrs), scopes: ['xapi/all', 'all'] });
    });

    it('client inconnu, mauvais secret ou désactivé → 401 avec défi Basic', async () => {
      for (const auth of [basic(CLIENT.key, 'faux'), basic('cle-off', 'secret-off'), basic('inconnu', 'x')]) {
        const res = await http().get('/auth/client/info').set('Authorization', auth).expect(401);
        expect(res.headers['www-authenticate']).toBe('Basic realm="Users"');
      }
    });

    it('POST /oauth2/token (JSON et formulaire), erreurs normalisées', async () => {
      const ok = await http().post('/oauth2/token').send({ grant_type: 'client_credentials', client_id: CLIENT.key, client_secret: CLIENT.secret }).expect(200);
      expect(ok.body).toMatchObject({ token_type: 'bearer', expires_in: 3600 });
      const stored = await db.collection('oAuthTokens').findOne({ accessToken: (ok.body as { access_token: string }).access_token });
      expect(stored?.clientId).toEqual(IDS.client);
      expect((stored?.expireAt as Date).getTime() - (stored?.createdAt as Date).getTime()).toBe(3600_000);
      await http().post('/oauth2/token').type('form').send({ grant_type: 'client_credentials', client_id: CLIENT.key, client_secret: CLIENT.secret }).expect(200);
      expect((await http().post('/oauth2/token').send({}).expect(400)).body).toEqual({ error: 'invalid_request' });
      expect((await http().post('/oauth2/token').send({ grant_type: 'password', client_id: 'a', client_secret: 'b' }).expect(400)).body).toEqual({ error: 'unsupported_grant_type' });
      expect((await http().post('/oauth2/token').send({ grant_type: 'client_credentials', client_id: CLIENT.key, client_secret: 'faux' }).expect(400)).body).toEqual({ error: 'invalid_client' });
    });

    it('refuse un opérateur MongoDB dans client_id (correctif D7)', async () => {
      const res = await http().post('/oauth2/token').send({ grant_type: 'client_credentials', client_id: { $ne: null }, client_secret: { $ne: null } }).expect(400);
      expect(res.body).toEqual({ error: 'invalid_client' });
    });
  });

  describe('réinitialisation du mot de passe', () => {
    it('demande : 204 pour un utilisateur connu ou inconnu, jeton bcrypt(email) valable 24 h', async () => {
      await http().post('/auth/resetpassword/request').send({ email: 'testy@mctestface.com' }).expect(204);
      await http().post('/auth/resetpassword/request').send({ email: 'inconnu@test.example' }).expect(204);
      const user = await db.collection('users').findOne({ _id: IDS.user });
      const tokens = user?.resetTokens as { token: string; expires: Date }[];
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.token).toMatch(/^\$2a\$08\$/);
      expect(Math.round(((tokens[0]?.expires.getTime() ?? 0) - Date.now()) / 3600_000)).toBe(24);
    });

    it('réinitialisation : 500 sans mot de passe, 404 jeton invalide, 400 mot de passe refusé, 200 sinon', async () => {
      await http().post('/auth/resetpassword/request').send({ email: 'testy@mctestface.com' }).expect(204);
      const token = ((await db.collection('users').findOne({ _id: IDS.user }))?.resetTokens as { token: string }[])[0]?.token;
      await http().post('/auth/resetpassword/reset').send({ email: 'testy@mctestface.com', token }).expect(500);
      await http().post('/auth/resetpassword/reset').send({ email: 'testy@mctestface.com', token: 'faux', password: 'Valide-2026' }).expect(404);
      await http().post('/auth/resetpassword/reset').send({ email: 'testy@mctestface.com', token: { $ne: 'x' }, password: 'Valide-2026' }).expect(404);
      const invalid = await http().post('/auth/resetpassword/reset').send({ email: 'testy@mctestface.com', token, password: 'court' }).expect(400);
      expect(invalid.body).toMatchObject({ name: 'ValidationError', errors: { password: { message: 'The password must be at least 8 characters long, The password must include at least one number', kind: 'user defined' } } });
      const ok = await http().post('/auth/resetpassword/reset').send({ email: 'testy@mctestface.com', token, password: 'Nouveau-mot-2026' }).expect(200);
      expect(ok.body).toMatchObject({ email: 'testy@mctestface.com', resetTokens: [] });
      const user = await db.collection('users').findOne({ _id: IDS.user });
      expect(user?.password).toMatch(/^\$2a\$08\$/);
      expect(user?.passwordHistory).toHaveLength(1);
      await http().post('/auth/jwt/password').set('Authorization', basic('testy@mctestface.com', 'Nouveau-mot-2026')).expect(200);
    });
  });

  describe('Google', () => {
    it('GOOGLE_ENABLED non vide sans identifiants : 500 (stratégie inconnue)', async () => {
      const google = await createTestApp({ GOOGLE_ENABLED: 'false' });
      await request(httpServer(google)).get('/auth/jwt/google').expect(500);
      await google.close();
    });
    it('GOOGLE_ENABLED vide : route inconnue', async () => {
      await http().get('/auth/jwt/google').expect(404);
    });
  });
});
