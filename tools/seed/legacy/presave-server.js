/* eslint-disable */
// Service HTTP exécuté DANS l'image legacy (Node 10 + babel-node), pour que le
// générateur de données produise exactement les mêmes documents que le front
// React : il appelle le vrai code de ui/src (buildModel des modèles de
// visualisation, preSave des schémas normalizr).
//
// CommonJS volontairement : ce fichier n'est pas sous /opt/ll, il n'est donc pas
// transpilé ; les modules qu'il charge (ui/…, lib/…) le sont via le .babelrc du dépôt.
//
// Lancement : voir tools/seed/README.md (NODE_PATH pointe sur des alias ui → ui/src, lib → lib).
//
// POST /presave  {schema, props}  → schemas[schema].preSave(fromJS(props)).toJS()
// POST /template {name, owner}    → preSave(buildModel(Map({owner}))) du modèle « name »
//                                   (nom du dossier ui/src/containers/Visualisations/Template*)
// POST /pipelines {visualisation, dashboardFilter?, orgTimezone?, now?}
//                                 → pipelines d'agrégation calculés par le front (voir pipelines())

const http = require('http');
const immutable = require('immutable');

// Fichiers statiques importés par les composants (gérés par webpack côté front) :
// comme ui/jest.config.json, on les remplace par des modules factices.
['.svg', '.png', '.jpg', '.jpeg', '.gif', '.woff', '.woff2', '.ttf', '.eot'].forEach(function (ext) {
  require.extensions[ext] = function (module, filename) { module.exports = filename; };
});
['.css', '.scss', '.sass', '.less'].forEach(function (ext) {
  require.extensions[ext] = function (module) { module.exports = {}; };
});

const schemas = require('ui/utils/schemas');

const TEMPLATES = [
  'TemplateActivityOverTime',
  'TemplateLast7DaysStatements',
  'TemplateLearningExperienceType',
  'TemplateMostActivePeople',
  'TemplateMostPopularActivities',
  'TemplateMostPopularVerbs',
  'TemplateStreamActivitiesWithMostComments',
  'TemplateStreamCommentCount',
  'TemplateStreamInteractionsVsEngagement',
  'TemplateStreamLearnerInteractionsByDateAndVerb',
  'TemplateStreamProportionOfSocialInteractions',
  'TemplateStreamUserEngagementLeaderboard',
  'TemplateWeekdaysActivity',
];

const buildModels = {};
TEMPLATES.forEach(function (name) {
  buildModels[name] = require('ui/containers/Visualisations/' + name + '/buildModel').default;
});

function toPlain(value) {
  return value && typeof value.toJS === 'function' ? value.toJS() : value;
}

function presave(schemaName, props) {
  const schema = schemas[schemaName];
  if (!schema) throw new Error('Schéma inconnu : ' + schemaName);
  // Même appel que ui/src/redux/modules/models/addModel.js
  return toPlain(schema.preSave(immutable.fromJS(props)));
}

// Pipelines d'agrégation d'une visualisation, tels que le front les envoie à /api/statements/aggregate.
// Reproduit visualisationPipelinesSelector (ui/src/redux/modules/visualise.js) :
//   body.visualisation  document tel que renvoyé par GET /api/v2/visualisation/:id
//   body.dashboardFilter filtre de partage (objet), optionnel
//   body.orgTimezone     fuseau de l'organisation (défaut UTC)
//   body.now             date de référence (ISO) : moment.now est figé pendant le calcul,
//                        pour que les périodes relatives (previewPeriod) soient déterministes.
function pipelines(body) {
  const moment = require('moment-timezone');
  const unflattenAxes = require('lib/helpers/visualisation').unflattenAxes;
  const pipelinesFromQueries = require('ui/utils/visualisations').pipelinesFromQueries;
  const savedNow = moment.now;
  const fixed = body.now ? new Date(body.now).getTime() : Date.now();
  moment.now = function () { return fixed; };
  try {
    const visualisation = immutable.fromJS(body.visualisation, schemas.visualisation.reviver);
    const filter = body.dashboardFilter ? [immutable.fromJS(body.dashboardFilter)] : null;
    const timezone = visualisation.get('timezone') || body.orgTimezone || 'UTC';
    const queries = visualisation.get('filters', new immutable.List()).map(function (vFilter) {
      if (!filter) return vFilter;
      return new immutable.Map({
        $match: new immutable.Map({ $and: new immutable.List([vFilter.get('$match', new immutable.Map())].concat(filter)) }),
      });
    });
    return toPlain(pipelinesFromQueries(
      queries,
      unflattenAxes(visualisation),
      visualisation.get('type'),
      visualisation.get('previewPeriod'),
      visualisation.get('journey'),
      timezone,
      visualisation.get('benchmarkingEnabled', false)
    ));
  } finally {
    moment.now = savedNow;
  }
}

function handle(path, body) {
  if (path === '/presave') return presave(body.schema, body.props);
  if (path === '/pipelines') return pipelines(body);
  if (path === '/template') {
    const build = buildModels[body.name];
    if (!build) throw new Error('Modèle inconnu : ' + body.name);
    const props = build(new immutable.Map({ owner: body.owner }));
    return presave('visualisation', props);
  }
  if (path === '/templates') return TEMPLATES;
  throw new Error('Route inconnue : ' + path);
}

http.createServer(function (req, res) {
  let raw = '';
  req.on('data', function (c) { raw += c; });
  req.on('end', function () {
    try {
      const out = handle(req.url, raw ? JSON.parse(raw) : {});
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: String(err && err.stack || err) }));
    }
  });
}).listen(8090, function () { console.log('presave-server prêt sur :8090'); });
