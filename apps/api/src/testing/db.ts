// Base de test MongoDB (ll_test_* uniquement) et jeu de données minimal, inséré sous la forme exacte
// des documents legacy (driver natif, sans passer par les schémas).
import mongoose, { type Connection } from 'mongoose';
import { hashLegacy } from '../security/bcrypt.js';
import { mongoTestUrl } from './app.js';

const { ObjectId } = mongoose.Types;

export const IDS = {
  org: new ObjectId('561a679c0c5d017e4004714e'),
  otherOrg: new ObjectId('561a679c0c5d017e40047150'),
  user: new ObjectId('561a679c0c5d017e4004714f'),
  member: new ObjectId('561a679c0c5d017e40047151'),
  adminRole: new ObjectId('561a679c0c5d017e40047152'),
  viewRole: new ObjectId('561a679c0c5d017e40047153'),
  lrs: new ObjectId('561a679c0c5d017e40047154'),
  client: new ObjectId('561a679c0c5d017e40047155'),
  untrustedClient: new ObjectId('561a679c0c5d017e40047156'),
  otherLrs: new ObjectId('561a679c0c5d017e40047157'),
  publicViz: new ObjectId('561a679c0c5d017e40047158'),
  privateViz: new ObjectId('561a679c0c5d017e40047159'),
  dashboard: new ObjectId('561a679c0c5d017e4004715a'),
  persona: new ObjectId('561a679c0c5d017e4004715b'),
};

export const PASSWORD = 'password1';
export const CLIENT = { key: 'cle-du-client', secret: 'secret-du-client' };

/** Ouvre la base de test, la vide (garde-fou : nom ll_test_*) et insère le jeu de données. */
export const openTestDb = async (): Promise<Connection> => {
  const url = mongoTestUrl();
  if (!url) throw new Error('MONGO_TEST_URL non défini');
  const connection = await mongoose.createConnection(url, { autoIndex: false, autoCreate: false }).asPromise();
  const name = connection.db?.databaseName ?? '';
  if (!name.startsWith('ll_test_')) throw new Error(`Base refusée : ${name}`);
  await connection.dropDatabase();
  return connection;
};

export const seed = async (connection: Connection): Promise<void> => {
  const db = connection.db;
  if (!db) throw new Error('Connexion fermée');
  const now = new Date('2026-01-01T00:00:00.000Z');
  const password = await hashLegacy(PASSWORD);
  await db.collection('organisations').insertMany([
    { _id: IDS.org, name: 'Organisation de test', owner: IDS.user, settings: { LOCKOUT_ENABLED: true, LOCKOUT_ATTEMPS: 3, LOCKOUT_SECONDS: 1800 }, timezone: 'Europe/Paris', createdAt: now, updatedAt: now, __v: 0 },
    { _id: IDS.otherOrg, name: 'Autre organisation', createdAt: now, updatedAt: now, __v: 0 },
  ]);
  await db.collection('role').insertMany([
    { _id: IDS.adminRole, title: 'Admin', organisation: IDS.org, scopes: ['all', 'org/public/dashboard/view'], createdAt: now, updatedAt: now, __v: 0 },
    { _id: IDS.viewRole, title: 'Observer', organisation: IDS.org, scopes: ['org/public/dashboard/view', 'org/public/visualisation/view'], createdAt: now, updatedAt: now, __v: 0 },
  ]);
  await db.collection('users').insertMany([
    {
      _id: IDS.user, email: 'testy@mctestface.com', name: 'Testy', password, scopes: ['site_admin'], verified: true,
      organisations: [IDS.org],
      organisationSettings: [{ _id: new ObjectId(), organisation: IDS.org, roles: [IDS.adminRole, IDS.viewRole], scopes: [], filter: '{}' }],
      ownerOrganisation: IDS.org,
      ownerOrganisationSettings: { LOCKOUT_ENABLED: true, LOCKOUT_ATTEMPS: 3, LOCKOUT_SECONDS: 1800, PASSWORD_MIN_LENGTH: 8, PASSWORD_REQUIRE_ALPHA: true, PASSWORD_REQUIRE_NUMBER: true, PASSWORD_HISTORY_CHECK: true, PASSWORD_HISTORY_TOTAL: 3 },
      passwordHistory: [], resetTokens: [], authFailedAttempts: 0, createdAt: now, updatedAt: now, __v: 0,
    },
    {
      _id: IDS.member, email: 'membre@test.example', name: 'Membre', password, scopes: [], verified: true,
      organisations: [IDS.org],
      organisationSettings: [{ _id: new ObjectId(), organisation: IDS.org, roles: [IDS.viewRole], scopes: [], filter: '{"statement.verb.id":"x"}' }],
      ownerOrganisation: IDS.org, createdAt: now, updatedAt: now, __v: 0,
    },
  ]);
  await db.collection('lrs').insertMany([
    { _id: IDS.lrs, title: 'Store', organisation: IDS.org, statementCount: 3, createdAt: now, updatedAt: now, __v: 0 },
    { _id: IDS.otherLrs, title: 'Store B', description: 'second', organisation: IDS.org, statementCount: 1, createdAt: now, updatedAt: now, __v: 0 },
    { title: 'Store d’une autre organisation', organisation: IDS.otherOrg, statementCount: 50, createdAt: now, updatedAt: now, __v: 0 },
  ]);
  await db.collection('visualisations').insertMany([
    { _id: IDS.publicViz, description: 'Publique', type: 'COUNTER', organisation: IDS.org, owner: IDS.member, isPublic: true, filters: [], createdAt: now, updatedAt: now, __v: 0 },
    { _id: IDS.privateViz, description: 'Privée', type: 'LEADERBOARD', organisation: IDS.org, owner: IDS.user, isPublic: false, createdAt: '2016-03-01T10:00:00.000Z', __v: 0 },
  ]);
  await db.collection('dashboards').insertOne({
    _id: IDS.dashboard, title: 'Tableau', organisation: IDS.org, owner: IDS.user, isPublic: false,
    widgets: [{ _id: new ObjectId(), visualisation: IDS.publicViz, x: 0, y: 0, w: 4, h: 4 }],
    shareable: [{ _id: new ObjectId(), title: 'Partage', filter: '{}', visibility: 'ANYWHERE', createdAt: now }],
    createdAt: now, updatedAt: now, __v: 0,
  });
  await db.collection('statements').insertMany([
    { organisation: IDS.org, lrs_id: IDS.lrs, client: IDS.client, statement: { id: 'a', verb: { id: 'x' }, context: { extensions: { 'https://ext&46;test/k': 1 } } }, timestamp: now, stored: now, voided: false, active: true },
    { organisation: IDS.org, lrs_id: IDS.lrs, statement: { id: 'b', verb: { id: 'y' } }, timestamp: now, stored: now, voided: false, active: true },
    { organisation: IDS.org, lrs_id: IDS.otherLrs, statement: { id: 'c', verb: { id: 'x' } }, timestamp: now, stored: now, voided: false, active: true },
    { organisation: IDS.otherOrg, lrs_id: IDS.lrs, statement: { id: 'd', verb: { id: 'x' } }, timestamp: now, stored: now },
  ]);
  await db.collection('personas').insertMany([
    { _id: IDS.persona, name: 'Alice', organisation: IDS.org },
    { name: 'Bob', organisation: IDS.org },
    { name: 'Carole', organisation: IDS.otherOrg },
  ]);
  await db.collection('personaAttributes').insertOne({ organisation: IDS.org, personaId: IDS.persona, key: 'classe', value: '4eA' });
  await db.collection('statements').updateOne({ 'statement.id': 'a' }, { $set: { 'person._id': IDS.persona } });
  await db.collection('client').insertMany([
    { _id: IDS.client, title: 'Client', organisation: IDS.org, lrs_id: IDS.lrs, api: { basic_key: CLIENT.key, basic_secret: CLIENT.secret }, isTrusted: true, scopes: ['xapi/all', 'all'], createdAt: now, updatedAt: now, __v: 0 },
    { _id: IDS.untrustedClient, title: 'Désactivé', organisation: IDS.org, lrs_id: IDS.lrs, api: { basic_key: 'cle-off', basic_secret: 'secret-off' }, isTrusted: false, scopes: ['all'], createdAt: now, updatedAt: now, __v: 0 },
  ]);
};

export const basic = (user: string, password: string): string => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
