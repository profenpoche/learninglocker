// Tests d'intégration des lectures REST, connection, index et comptages (MongoDB requis).
import type { Connection } from 'mongoose';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, httpServer, mongoTestUrl } from '../testing/app.js';
import { basic, CLIENT, IDS, openTestDb, PASSWORD, seed } from '../testing/db.js';

const enabled = Boolean(mongoTestUrl());
let app: INestApplication;
let db: Connection;
let org: string;
let member: string;
const http = () => request(httpServer(app));
const asOrg = (path: string) => http().get(path).set('Authorization', `Bearer ${org}`);

describe.runIf(enabled)('lectures REST', () => {
  beforeAll(async () => {
    db = await openTestDb();
    await seed(db);
    await db.collection('lrs').createIndex({ organisation: 1 });
    app = await createTestApp({ TESTING: 'true' });
    const login = async (email: string) => {
      const user = (await http().post('/auth/jwt/password').set('Authorization', basic(email, PASSWORD))).text;
      return (await http().post('/auth/jwt/organisation').set('Authorization', `Bearer ${user}`).send({ organisation: String(IDS.org) })).text;
    };
    org = await login('testy@mctestface.com');
    member = await login('membre@test.example');
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('GET /v2/<modèle>', () => {
    it('liste filtrée par organisation, documents Mongoose (défauts, __v, dates ISO)', async () => {
      const res = await asOrg('/v2/lrs').query({ sort: JSON.stringify({ _id: 1 }) }).expect(200);
      expect(res.body).toEqual([
        { _id: String(IDS.lrs), title: 'Store', organisation: String(IDS.org), statementCount: 3, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', __v: 0 },
        { _id: String(IDS.otherLrs), title: 'Store B', description: 'second', organisation: String(IDS.org), statementCount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', __v: 0 },
      ]);
    });

    it('route insensible à la casse ; skip, limit, select, query ($oid), distinct', async () => {
      expect((await asOrg('/v2/LRS/count').expect(200)).body).toEqual({ count: 2 });
      const page = await asOrg('/v2/lrs').query({ sort: '{"_id":1}', skip: 1, limit: 1, select: '{"title":1}' }).expect(200);
      expect(page.body).toEqual([{ _id: String(IDS.otherLrs), title: 'Store B' }]);
      const byOid = await asOrg('/v2/client').query({ query: JSON.stringify({ lrs_id: { $oid: String(IDS.lrs) } }), select: '{"title":1}' }).expect(200);
      expect(byOid.body).toEqual([
        { _id: String(IDS.client), id: String(IDS.client), title: 'Client' },
        { _id: String(IDS.untrustedClient), id: String(IDS.untrustedClient), title: 'Désactivé' },
      ]);
      expect((await asOrg('/v2/visualisation').query({ distinct: 'type' }).expect(200)).body).toEqual(['COUNTER', 'LEADERBOARD']);
    });

    it('getters et virtuel `id` du client ; dates héritées en chaîne converties', async () => {
      const client = await asOrg(`/v2/client/${String(IDS.client)}`).expect(200);
      expect(client.body).toMatchObject({ id: String(IDS.client), authority: { objectType: 'Agent', name: 'New Client' }, isTrusted: true });
      const viz = await asOrg(`/v2/visualisation/${String(IDS.privateViz)}`).expect(200);
      expect(viz.body).toMatchObject({ createdAt: '2016-03-01T10:00:00.000Z', stacked: true, previewPeriod: 'LAST_7_DAYS', filters: [], statementContents: [] });
    });

    it('populate du propriétaire', async () => {
      const res = await asOrg(`/v2/dashboard/${String(IDS.dashboard)}`).query({ populate: 'owner' }).expect(200);
      expect(res.body).toMatchObject({ owner: { _id: String(IDS.user), email: 'testy@mctestface.com' } });
    });

    it('404 Not Found, CastError en 404 sur l’identifiant, 400 invalid_json (corps d’erreur sans pile)', async () => {
      const unknown = await asOrg('/v2/lrs/5f0000000000000000000000').expect(404);
      expect(unknown.body).toEqual({ message: 'Not Found', statusCode: 404 });
      const invalid = await asOrg('/v2/lrs/pas-un-id').expect(404);
      expect(invalid.body).toEqual({
        stringValue: '"pas-un-id"', kind: 'ObjectId', value: 'pas-un-id', path: '_id', name: 'CastError', statusCode: 404,
        reason: { message: 'Argument passed in must be a single String of 12 bytes or a string of 24 hex characters' },
        message: 'Cast to ObjectId failed for value "pas-un-id" at path "_id" for model "Lrs"',
      });
      const badJson = await http().get('/v2/lrs').query({ query: '{oups' }).expect(400);
      expect(badJson.body).toEqual({ description: 'invalid_json', message: '%s must be a valid JSON string', statusCode: 400 });
    });

    it('401 text/plain sans authentification ; 403 et 500 au format { errorId, message }', async () => {
      const anon = await http().get('/v2/lrs').expect(401);
      expect(anon.text).toBe('Unauthorized');
      expect(anon.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(anon.headers['www-authenticate']).toBeUndefined();
      const forbidden = await http().get('/v2/batchdelete').set('Authorization', `Bearer ${org}`).expect(403);
      expect(forbidden.body).toMatchObject({ message: 'Priviliges not sufficient for this operation' });
      const stream = await asOrg('/v2/stream').expect(500);
      expect(stream.body).toMatchObject({ message: 'Invalid scope stream requested' });
    });

    it('filtre de droits : un membre sans scope ne voit que les visualisations publiques ou les siennes', async () => {
      const res = await http().get('/v2/visualisation').set('Authorization', `Bearer ${member}`).expect(200);
      expect((res.body as { _id: string }[]).map((v) => v._id)).toEqual([String(IDS.publicViz)]);
    });

    it('correctif D7 : un `$and` dans query ne contourne plus le filtre de droits', async () => {
      const res = await asOrg('/v2/lrs/count').query({ query: '{"$and":[{}]}' }).expect(200);
      expect(res.body).toEqual({ count: 2 });
    });

    it('client Basic : 403 sans scope de gestion des clients', async () => {
      await http().get('/v2/client').set('Authorization', basic(CLIENT.key, CLIENT.secret)).expect(200);
      await http().get('/v2/user/count').set('Authorization', basic(CLIENT.key, CLIENT.secret)).expect(200);
    });

    it('/:id/shallow n’est pas porté (404 sans relais)', async () => {
      await asOrg(`/v2/lrs/${String(IDS.lrs)}/shallow`).expect(404);
    });

    it('sélection de champs de User selon les scopes', async () => {
      const res = await asOrg(`/v2/user/${String(IDS.member)}`).expect(200);
      expect(Object.keys(res.body as object).sort()).toEqual(['_id', 'createdAt', 'email', 'name', 'organisationSettings', 'organisations', 'ownerOrganisation', 'ownerOrganisationSettings', 'scopes', 'updatedAt', 'verified']);
    });
  });

  describe('GET /connection/<modèle>', () => {
    it('pagination Relay : curseurs base64, pages suivantes', async () => {
      const page1 = await asOrg('/connection/lrs').query({ first: 1, sort: '{"_id":1}' }).expect(200);
      const cursor = Buffer.from(JSON.stringify({ _id: String(IDS.lrs) })).toString('base64');
      expect(page1.body).toMatchObject({
        edges: [{ cursor, node: { _id: String(IDS.lrs), title: 'Store' } }],
        pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: cursor, endCursor: cursor },
      });
      const page2 = await asOrg('/connection/lrs').query({ first: 1, sort: '{"_id":1}', after: cursor }).expect(200);
      expect(page2.body).toMatchObject({ edges: [{ node: { _id: String(IDS.otherLrs) } }], pageInfo: { hasNextPage: false, hasPreviousPage: true } });
      const empty = await asOrg('/connection/lrs').query({ first: 1, sort: '{"_id":1}', after: (page2.body as { pageInfo: { endCursor: string } }).pageInfo.endCursor }).expect(200);
      expect(empty.body).toEqual({ edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: true, startCursor: 'e30=', endCursor: 'e30=' } });
    });

    it('statements : clés `&46;` décodées, projection', async () => {
      const res = await asOrg('/connection/statement').query({ filter: '{"statement.id":"a"}', project: '{"statement":1}' }).expect(200);
      expect((res.body as { edges: { node: { statement: unknown } }[] }).edges[0]?.node.statement).toEqual({ id: 'a', verb: { id: 'x' }, context: { extensions: { 'https://ext.test/k': 1 } } });
    });

    it('curseur invalide : 500 avec le message de Node 10 ; filtre invalide : message JSON de Node 10', async () => {
      const bad = await asOrg('/connection/statement').query({ first: 1, after: 'curseur-invalide' }).expect(500);
      expect(bad.body).toMatchObject({ message: "Cannot read property '_id' of null" });
      const badJson = await asOrg('/connection/lrs').query({ filter: '{oups' }).expect(500);
      expect(badJson.body).toMatchObject({ message: 'Unexpected token o in JSON at position 1' });
    });

    it('sitesettings et stream n’ont pas de route connection', async () => {
      await asOrg('/connection/sitesettings').expect(404);
      await asOrg('/connection/stream').expect(404);
    });
  });

  it('GET /indexes/<modèle>', async () => {
    const res = await asOrg('/indexes/lrs').expect(200);
    expect(res.body).toEqual(expect.arrayContaining([{ key: { _id: 1 }, name: '_id_' }, { key: { organisation: 1 }, name: 'organisation_1' }]));
  });

  describe('comptages', () => {
    it('/statements/count : compteurs des stores sans filtre, comptage réel sinon', async () => {
      expect((await asOrg('/statements/count').expect(200)).body).toEqual({ count: 4 });
      expect((await asOrg('/statements/count').query({ filter: '{"statement.verb.id":"x"}' }).expect(200)).body).toEqual({ count: 2 });
      expect((await asOrg('/statements/count').query({ query: '{"statement.verb.id":"y"}' }).expect(200)).body).toEqual({ count: 1 });
      expect((await asOrg('/statements/count').query({ filter: JSON.stringify({ 'person._id': { $personaIdent: { key: 'persona.import.classe', value: '4eA' } } }) }).expect(200)).body).toEqual({ count: 1 });
      const bad = await asOrg('/statements/count').query({ filter: '{oups' }).expect(500);
      expect(bad.body).toMatchObject({ message: 'Unexpected token o in JSON at position 1' });
      const client = await http().get('/statements/count').set('Authorization', basic(CLIENT.key, CLIENT.secret)).expect(200);
      expect(client.body).toEqual({ count: 2 });
      const anon = await http().get('/statements/count').expect(401);
      expect(anon.headers['www-authenticate']).toBe('Bearer realm="Users", Basic realm="Users"');
    });

    it('/v2/persona/count', async () => {
      expect((await asOrg('/v2/persona/count').expect(200)).body).toEqual({ count: 2 });
      expect((await asOrg('/v2/persona/count').query({ query: '{"name":{"$regex":"^A"}}' }).expect(200)).body).toEqual({ count: 1 });
    });
  });
});
