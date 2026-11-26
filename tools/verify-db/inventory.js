// Inventaire d'une base Learning Locker, au format JSON (mongosh).
// Sert à l'état des lieux (lot 1) puis à chaque répétition de migration (lot 9) :
// deux inventaires se comparent avec tools/verify-db/compare.mjs.
//
// Usage : mongosh --quiet "mongodb://127.0.0.1:27018/learninglocker_v2" tools/verify-db/inventory.js > inventaire.json
// Option : SAMPLE (taille de l'échantillon pour les types de champs, défaut 2000).

const SAMPLE = Number(process.env.SAMPLE || 2000);

function fieldTypes(coll) {
  // Types des champs de premier niveau, sur un échantillon.
  const rows = coll.aggregate([
    { $sample: { size: SAMPLE } },
    { $project: { kv: { $objectToArray: '$$ROOT' } } },
    { $unwind: '$kv' },
    { $group: { _id: { k: '$kv.k', t: { $type: '$kv.v' } }, n: { $sum: 1 } } },
    { $sort: { '_id.k': 1, '_id.t': 1 } },
  ], { allowDiskUse: true }).toArray();
  const out = {};
  rows.forEach((r) => {
    out[r._id.k] = out[r._id.k] || {};
    out[r._id.k][r._id.t] = r.n;
  });
  return out;
}

const result = {
  generatedAt: new Date().toISOString(),
  server: db.version(),
  database: db.getName(),
  collections: {},
};

db.getCollectionInfos({ type: 'collection' })
  .map((c) => c.name)
  .filter((name) => !name.startsWith('system.'))
  .sort()
  .forEach((name) => {
    const coll = db.getCollection(name);
    result.collections[name] = {
      count: coll.countDocuments({}),
      indexes: coll.getIndexes().map((ix) => {
        const o = { name: ix.name, key: ix.key };
        ['unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression', 'collation'].forEach((opt) => {
          if (ix[opt] !== undefined) o[opt] = ix[opt];
        });
        return o;
      }),
      fieldTypes: fieldTypes(coll),
    };
  });

// Contrôles ciblés sur les formes de données sensibles (cf. docs/02-donnees.md §8)
const types = (coll, path) => db.getCollection(coll).aggregate([
  { $group: { _id: { $type: `$${path}` }, n: { $sum: 1 } } }, { $sort: { _id: 1 } },
]).toArray().reduce((acc, r) => Object.assign(acc, { [r._id]: r.n }), {});

result.checks = {
  migrations: db.migrations.find({}, { _id: 0, key: 1, order: 1 }).sort({ order: 1 }).toArray(),
  siteSettings: db.siteSettings.find({}, { _id: 1, dontShowRegistration: 1 }).toArray(),
  createdAtTypes: ['client', 'lrs', 'organisations', 'users', 'visualisations'].reduce(
    (acc, c) => Object.assign(acc, { [c]: types(c, 'createdAt') }), {},
  ),
  clientAuthorityTypes: types('client', 'authority'),
  visualisationFiltersElemTypes: db.visualisations.aggregate([
    { $unwind: '$filters' }, { $group: { _id: { $type: '$filters' }, n: { $sum: 1 } } },
  ]).toArray(),
  statements: {
    timestampTypes: types('statements', 'timestamp'),
    storedTypes: types('statements', 'stored'),
    voided: db.statements.countDocuments({ voided: true }),
    withPerson: db.statements.countDocuments({ 'person._id': { $exists: true } }),
    withAttachments: db.statements.countDocuments({ 'statement.attachments': { $exists: true } }),
    dotEncodedExtensionKeys: db.statements.countDocuments({ 'statement.context.extensions': { $exists: true } }),
    completedQueuesSizes: db.statements.aggregate([
      { $group: { _id: { $size: { $ifNull: ['$completedQueues', []] } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ]).toArray(),
    legacyFields: {
      lrs: db.statements.countDocuments({ lrs: { $exists: true } }),
      client_id: db.statements.countDocuments({ client_id: { $exists: true } }),
      refs: db.statements.countDocuments({ refs: { $exists: true } }),
    },
  },
  oldPersonaIdentifiersCollection: db.getCollectionNames().includes('personaidentifiers'),
};

print(JSON.stringify(result, null, 2));
