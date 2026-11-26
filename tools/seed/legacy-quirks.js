// Formes de données héritées, injectées directement en base (mongosh) après le seed.
// Elles existent dans les bases de production anciennes (migrations v1, champs « old* »…)
// mais ne peuvent plus être produites par les API actuelles. Le nouveau code doit les tolérer.
// Cf. docs/02-donnees.md §8, point 24.
//
// Usage : mongosh --quiet "mongodb://127.0.0.1:27018/learninglocker_v2" tools/seed/legacy-quirks.js

const org = db.organisations.findOne({ parent: { $exists: false } });
const lrs = db.lrs.findOne({ organisation: org._id, title: 'LRS Collège' });
const report = {};

// 1. Horodatages en chaîne ISO (commande v1 migrateTimestamps)
const client = db.client.findOne({ title: 'API sans store' });
db.client.updateOne({ _id: client._id }, { $set: { createdAt: '2016-03-01T10:00:00.000Z', updatedAt: '2016-03-02T10:00:00.000Z' } });
report.clientWithStringDates = client._id;

// 2. Visualisation ancienne génération : champ « axes » JSON seul, filtres « old* », déjà migrée
const vizId = new ObjectId();
db.visualisations.insertOne({
  _id: vizId,
  organisation: org._id,
  owner: org.owner,
  description: 'Ancienne visualisation (axes JSON, oldFilters)',
  type: 'LEADERBOARD',
  axes: JSON.stringify({ group: { optionKey: 'verb', searchString: 'Verb' }, operator: 'uniqueCount', value: { optionKey: 'statements', searchString: 'Statements' } }),
  filters: [JSON.stringify({ $match: { 'statement.verb.id': { $in: ['http://adlnet.gov/expapi/verbs/completed'] } } })],
  oldFilters: [JSON.stringify({ $match: { $or: [{ 'statement.verb.id': 'http://adlnet.gov/expapi/verbs/completed' }] } })],
  hasBeenMigrated: true,
  isPublic: false,
  createdAt: new Date('2017-05-10T08:00:00Z'),
  updatedAt: new Date('2019-03-07T13:00:00Z'),
  __v: 0,
});
report.legacyVisualisation = vizId;

// 3. Ancienne collection personaidentifiers (avant migration 20171127)
db.personaidentifiers.insertOne({
  organisation: org._id,
  uniqueIdentifier: { key: 'statement.actor.mbox', value: 'mailto:ancien@profenpoche.test' },
  identifiers: [{ key: 'statement.actor.name', value: 'Ancien Format' }],
  persona: null,
});
report.oldPersonaIdentifiers = db.personaidentifiers.countDocuments({});

// 4. Statement au format v1 (champs lrs, client_id, refs)
const v1Id = new ObjectId();
db.statements.insertOne({
  _id: v1Id,
  lrs: { _id: lrs._id, name: lrs.title },
  lrs_id: lrs._id,
  client_id: 'ancien-client-v1',
  organisation: org._id,
  statement: {
    id: 'a0a0a0a0-0000-4000-8000-000000000001',
    actor: { objectType: 'Agent', name: 'Élève v1', mbox: 'mailto:v1@eleves.profenpoche.test' },
    verb: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: { 'en-US': 'experienced' } },
    object: { objectType: 'Activity', id: 'https://profenpoche.test/xapi/activities/cours/1' },
    timestamp: '2015-09-01T08:00:00.000Z',
    stored: '2015-09-01T08:00:01.000Z',
    authority: { objectType: 'Agent', name: 'v1', mbox: 'mailto:v1@profenpoche.test' },
    version: '1.0.1',
  },
  refs: [],
  active: true,
  voided: false,
  timestamp: new Date('2015-09-01T08:00:00Z'),
  stored: new Date('2015-09-01T08:00:01Z'),
});
report.v1Statement = v1Id;

// 5. Utilisateur avec filtre « old » et marqueur de migration
const user = db.users.findOne({ email: 'filtre@profenpoche.test' });
db.users.updateOne(
  { _id: user._id, 'organisationSettings.organisation': org._id },
  { $set: { hasBeenMigrated: true, 'organisationSettings.$.oldFilter': JSON.stringify({ $or: [{ 'statement.context.platform': 'Profenpoche App' }] }) } },
);
report.userWithOldFilter = user._id;

// 6. Dashboard avec les anciens champs de partage à la racine (avant migration 20180320)
const dash = db.dashboards.findOne({ title: 'Blank Dashboard' });
db.dashboards.updateOne({ _id: dash._id }, { $set: { filter: '{}', visibility: 'NOWHERE', validDomains: null } });
report.dashboardWithRootShareFields = dash._id;

printjson(report);
