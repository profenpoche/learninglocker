// Serveur d'oracle des briques communes (lot 4), exécuté DANS l'image legacy (Node 10 + babel-node).
// Il appelle le vrai code de lib/ et ui/src et renvoie ses résultats sous une forme JSON « étiquetée »
// (voir tag()) : ObjectId, Date, undefined, Error, NaN… y restent distinguables.
//
// Les dépendances qui lisent la base sont remplacées, AVANT tout chargement, par des faux déterministes
// (mêmes faux que dans les tests de packages/shared) :
//   - lib/connections/personaService : getAttributes lit la table `attributes` de la requête ;
//   - lib/services/auth/filters/getScopeFilter : filtre fixe, dépendant du modèle ;
//   - lib/connections/mongoose : connexion jamais ouverte (aucun accès réseau) ;
//   - bcryptjs : compare(valeur, empreinte) ⇔ empreinte === 'h:' + valeur.
// Le conteneur est lancé sans accès à la base (voir tools/oracle/libs.sh).
//
// CommonJS volontairement : fichier hors de /opt/ll, non transpilé ; les modules chargés (lib/…, ui/…)
// le sont par le .babelrc du dépôt. NODE_PATH pointe sur des alias ui → ui/src, lib → lib.
//
// POST /<route> {…} → { ok: true, value } ou { ok: false, error } ; voir HANDLERS.

const http = require('http');
const Module = require('module');

['.svg', '.png', '.jpg', '.jpeg', '.gif', '.woff', '.woff2', '.ttf', '.eot'].forEach(function (ext) {
  require.extensions[ext] = function (module, filename) { module.exports = filename; };
});
['.css', '.scss', '.sass', '.less'].forEach(function (ext) {
  require.extensions[ext] = function (module) { module.exports = {}; };
});

// --- Faux ---------------------------------------------------------------------------------------

function stubModule(request, exportsValue) {
  const filename = require.resolve(request);
  const m = new Module(filename, module);
  m.filename = filename;
  m.loaded = true;
  m.exports = exportsValue;
  require.cache[filename] = m;
}

const state = { attributes: [], calls: [] };

stubModule('lib/connections/personaService', {
  __esModule: true,
  default: function () {
    return {
      getAttributes: function (opts) {
        state.calls.push({ fn: 'getAttributes', filter: opts.filter, organisation: opts.organisation, limit: opts.limit, maxTimeMS: opts.maxTimeMS });
        if (opts.filter.key === 'boom') return Promise.reject(new Error('persona-service indisponible'));
        const ObjectId = require('mongoose').Types.ObjectId;
        const edges = state.attributes
          .filter(function (a) {
            return a.key === opts.filter.key
              && JSON.stringify(a.value) === JSON.stringify(opts.filter.value)
              && (a.organisation === undefined || a.organisation === String(opts.organisation));
          })
          .map(function (a) {
            const node = {};
            if ('personaId' in a) node.personaId = typeof a.personaId === 'string' ? ObjectId(a.personaId) : a.personaId;
            return { node: node };
          });
        return Promise.resolve({ edges: edges });
      },
    };
  },
});

stubModule('lib/services/auth/filters/getScopeFilter', {
  __esModule: true,
  default: function (opts) {
    state.calls.push({ fn: 'getScopeFilter', modelName: opts.modelName, actionName: opts.actionName, allowDashboardAccess: opts.allowDashboardAccess });
    if (opts.authInfo && opts.authInfo.scopeError) return Promise.reject(new Error('portée refusée'));
    const ObjectId = require('mongoose').Types.ObjectId;
    return Promise.resolve({ organisation: ObjectId('6b083fe419b92523f89d6725'), model: opts.modelName, $comment: 'scope' });
  },
});

stubModule('lib/connections/mongoose', (function () {
  const mongoose = require('mongoose');
  const connection = mongoose.createConnection();
  return { __esModule: true, getConnection: function () { return connection; }, default: connection };
})());

const silent = function () {};
stubModule('lib/logger', { __esModule: true, default: { error: silent, warn: silent, info: silent, debug: silent, silly: silent, verbose: silent, log: silent } });

stubModule('bcryptjs', {
  __esModule: true,
  compare: function (value, hash) { return Promise.resolve(hash === 'h:' + value); },
  hash: function (value, rounds, cb) { cb(null, 'h:' + value); },
  default: undefined,
});
require.cache[require.resolve('bcryptjs')].exports.default = require.cache[require.resolve('bcryptjs')].exports;

// --- Sérialisation étiquetée -----------------------------------------------------------------------

function tag(value) {
  if (value === undefined) return { $$undefined: true };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $$number: 'NaN' };
    if (value === Infinity) return { $$number: 'Infinity' };
    if (value === -Infinity) return { $$number: '-Infinity' };
    if (value === 0 && 1 / value < 0) return { $$number: '-0' };
    return value;
  }
  if (typeof value === 'function') return { $$function: true };
  if (value === null || typeof value !== 'object') return value;
  const kind = Object.prototype.toString.call(value);
  if (Object.prototype.hasOwnProperty.call(value, '_bsontype')) return { $$oid: value.toHexString() };
  if (kind === '[object Date]') return { $$date: Number.isNaN(value.getTime()) ? 'Invalid' : value.getTime() };
  if (kind === '[object Error]') return { $$error: { name: value.name, message: value.message } };
  if (Array.isArray(value)) return value.map(tag);
  const proto = Object.getPrototypeOf(value);
  const out = {};
  if (proto !== Object.prototype && proto !== null) out.$$proto = proto && proto.constructor ? proto.constructor.name : String(proto);
  Object.keys(value).forEach(function (key) {
    Object.defineProperty(out, key, { value: tag(value[key]), enumerable: true, configurable: true, writable: true });
  });
  return out;
}

// --- Routes ---------------------------------------------------------------------------------------

function withCalls(promise) {
  return promise.then(function (value) {
    const calls = state.calls;
    state.calls = [];
    return { result: value, calls: calls };
  });
}

const HANDLERS = {
  // Convertit une chaîne en ObjectId comme convert$oid (mongoose.Types.ObjectId).
  objectid: function (body) {
    const ObjectId = require('mongoose').Types.ObjectId;
    try {
      return ObjectId(body.value);
    } catch (err) {
      return { thrown: err.message };
    }
  },

  parseQuery: function (body) {
    const parseQuery = require('lib/helpers/parseQuery').default;
    state.attributes = body.attributes || [];
    state.calls = [];
    const options = body.optionsUndefined ? undefined : 'options' in body ? body.options : { authInfo: body.authInfo };
    return withCalls(parseQuery(body.pipeline, options));
  },

  helper: function (body) {
    const fn = require('lib/helpers/' + body.name).default;
    state.attributes = body.attributes || [];
    state.calls = [];
    return withCalls(Promise.resolve().then(function () { return fn.apply(null, body.args); }));
  },

  scopes: function (body) {
    const scopes = require('lib/helpers/scopes');
    const orgScopes = require('lib/constants/orgScopes');
    const constants = require('lib/constants/scopes');
    const roleForm = require('ui/pages/SettingsRolesPage/RoleForm');
    const immutable = require('immutable');
    const list = body.scopes === undefined ? undefined : body.scopes;
    switch (body.fn) {
      case 'dependencies': return scopes.getScopeDependencies(list)(body.scope);
      case 'dependents': return scopes.getScopeDependents(list)(body.scope);
      case 'generateNewScopes': return roleForm.generateNewScopes(immutable.Set(body.oldScopes), body.scope, body.checked).toJS();
      case 'groupScopes': return roleForm.groupScopes(list);
      case 'getLabel': return roleForm.getLabel(body.key);
      case 'getRowLabel': return roleForm.getRowLabel(body.key);
      case 'canViewModel': return require('lib/services/auth/canViewModel').default(body.modelName, body.activeScopes);
      case 'canCreateOrganisations': return require('lib/services/auth/canCreateOrganisations').default(body.activeScopes, body.options);
      case 'boolean': return require('boolean')(body.value);
      // api/src/auth/jwt.js (createOrgTokenPayload) : [...union(...roles.map(r => r.scopes)), ...user.scopes]
      case 'orgTokenScopes': return [].concat(require('lodash').union.apply(null, body.roleScopes), body.userScopes);
      case 'getXapiScopes': return 'deleteStatementsEnabled' in body ? constants.getXapiScopes(body.deleteStatementsEnabled) : constants.getXapiScopes();
      case 'constants': return {
        orgScopes: orgScopes.default,
        roleGroupNames: orgScopes.roleGroupNames,
        constants: Object.keys(constants).filter(function (k) { return typeof constants[k] !== 'function'; }).reduce(function (acc, k) { acc[k] = constants[k]; return acc; }, {}),
        orgConstants: Object.keys(orgScopes).filter(function (k) { return k !== 'default' && typeof orgScopes[k] === 'string'; }).reduce(function (acc, k) { acc[k] = orgScopes[k]; return acc; }, {}),
      };
      default: throw new Error('fonction inconnue : ' + body.fn);
    }
  },

  password: function (body) {
    if (body.fn === 'util') {
      try {
        return require('lib/utils/validators/User').validatePasswordUtil(body.value, body.settings);
      } catch (err) {
        return { thrown: err.name, message: err.message };
      }
    }
    // Validateur mongoose du champ password (lib/models/user.js), appelé sur un faux document.
    const User = require('lib/models/user').default;
    const validator = User.schema.path('password').validators[0].validator;
    const doc = {
      isModified: function () { return body.modified !== false; },
      ownerOrganisationSettings: body.settings,
      passwordHistory: body.history,
    };
    return Promise.resolve().then(function () { return validator.call(doc, body.value); })
      .then(function (value) { return { valid: value }; }, function (err) { return { thrown: err.name, message: err.message }; });
  },

  ifi: function (body) {
    const mod = require('lib/services/persona/validateIfi');
    const message = require('api/controllers/utils/constructMessageFromRulrWarning').constructMessageFromRulrWarning;
    const rulr = require('rulr');
    const XTypeWarning = require('@learninglocker/xapi-validation/dist/warnings/TypeWarning').default;
    const kind = function (w) {
      if (w instanceof XTypeWarning) return 'XapiTypeWarning';
      if (w instanceof rulr.Warnings) return 'Warnings';
      if (w instanceof rulr.TypeWarning) return 'TypeWarning';
      if (w instanceof rulr.RequiredWarning) return 'RequiredWarning';
      if (w instanceof rulr.RestrictedKeysWarning) return 'RestrictedKeysWarning';
      if (w instanceof rulr.Warning) return 'Warning';
      return typeof w;
    };
    const describe = function (warnings) {
      return warnings.map(function (w) {
        if (!(w instanceof rulr.Warning)) return { kind: kind(w), raw: w, message: message(w) };
        const out = { kind: kind(w), name: w.name, message: message(w), warningMessage: w.message, path: w.path, data: w.data };
        if ('typeName' in w) out.typeName = w.typeName;
        if ('type' in w) out.type = w.type && w.type.name;
        if ('keys' in w) out.keys = w.keys;
        return out;
      });
    };
    const fn = body.fn === 'validateIfis' ? mod.validateIfis : body.fn === 'default' ? mod.default : mod.validateIfi;
    try {
      const out = fn(body.ifi, body.path);
      return body.fn === 'validateIfi' ? { warnings: describe(out) } : { returned: out };
    } catch (err) {
      if (err instanceof rulr.Warnings) return { thrown: 'Warnings', message: message(err), path: err.path, data: err.data, warnings: describe(err.warnings) };
      return { thrown: err && err.name };
    }
  },

  // ui/src/utils/schemas.js : preSave (comme addModel) et reviver (comme entityReviver).
  presave: function (body) {
    const schema = require('ui/utils/schemas')[body.schema];
    if (!schema) throw new Error('Schéma inconnu : ' + body.schema);
    const out = schema.preSave(require('immutable').fromJS(body.props));
    return out && typeof out.toJS === 'function' ? out.toJS() : out;
  },

  revive: function (body) {
    const schema = require('ui/utils/schemas')[body.schema];
    if (!schema) throw new Error('Schéma inconnu : ' + body.schema);
    const out = require('immutable').fromJS(body.doc, schema.reviver);
    return out && typeof out.toJS === 'function' ? out.toJS() : out;
  },

  // ui/src/utils/queries (index.js, has$dte.js) : entrées JSON converties par fromJS, sorties toJS.
  queries: function (body) {
    const q = require('ui/utils/queries');
    const has$dte = require('ui/utils/queries/has$dte').default;
    const I = require('immutable');
    switch (body.fn) {
      // entrySeq().toJS() laisserait les clés (des Map) telles quelles : conversion explicite.
      case 'getCriteria': return q.getCriteria(I.fromJS(body.query)).entrySeq().toArray().map(function (e) {
        return [e[0] && typeof e[0].toJS === 'function' ? e[0].toJS() : e[0], e[1] && typeof e[1].toJS === 'function' ? e[1].toJS() : e[1]];
      });
      case 'deleteCriterion': return q.deleteCriterion(q.getCriteria(I.fromJS(body.query)), I.fromJS(body.key)).toJS();
      case 'addTokenToQuery': return q.addTokenToQuery(I.fromJS(body.query), I.fromJS(body.keyPath), I.fromJS(body.token)).toJS();
      case 'addCriterionFromSection': return q.addCriterionFromSection(I.fromJS(body.query), I.fromJS(body.criterion), I.fromJS(body.section)).toJS();
      case 'queryToStringList': return q.queryToStringList(I.fromJS(body.query)).toJS();
      case 'has$dte': return has$dte(I.fromJS(body.query));
      default: throw new Error('fonction inconnue : ' + body.fn);
    }
  },

  ifiUi: function (body) {
    const fn = require('ui/pages/PeopleManagePage/IdentifiersEditor/hasIdentifierValueErrors').default;
    const value = body.type === 'account' ? require('immutable').fromJS(body.value) : body.value;
    try {
      return { hasErrors: fn(body.type, value) };
    } catch (err) {
      return { thrown: String(err && err.name) };
    }
  },
};

http.createServer(function (req, res) {
  let raw = '';
  req.on('data', function (c) { raw += c; });
  req.on('end', function () {
    const route = req.url.slice(1);
    Promise.resolve()
      .then(function () {
        const handler = HANDLERS[route];
        if (!handler) throw new Error('Route inconnue : ' + route);
        return handler(raw ? JSON.parse(raw) : {});
      })
      .then(function (value) {
        const body = JSON.stringify({ ok: true, value: tag(value) });
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      })
      .catch(function (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: tag(err), stack: String(err && err.stack) }));
      });
  });
}).listen(8090, function () { console.log('lib-oracle-server prêt sur :8090'); });
