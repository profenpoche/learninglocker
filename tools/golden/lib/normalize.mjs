// Normalisation des réponses enregistrées : ce qui change d'une exécution à l'autre est remplacé
// par un repère stable, tout le reste est conservé tel quel.
//
// - ObjectId créé pendant l'enregistrement (horodatage ≥ début)  → <new-id:N> (ordre d'apparition)
//   Les ObjectId de l'instantané restent littéraux : ils sont identiques après restauration.
// - Date ISO ou HTTP postérieure au début de l'enregistrement     → <now>
// - JWT                                                            → <jwt {claims sans iat/exp} ttl=…>
// - errorId                                                        → <errorId>
// - Secrets générés (clés de client, jetons OAuth…) hors manifeste → <secret:N>
// - Frontière multipart                                            → <boundary>
// - Corps binaire                                                  → { sha256, length }
const OID = /^[0-9a-f]{24}$/;
const OID_IN_TEXT = /(?<![0-9a-f])[0-9a-f]{24}(?![0-9a-f])/g;
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
const JWT_IN_TEXT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const SECRET_KEYS = new Set(['basic_key', 'basic_secret', 'access_token', 'refresh_token', 'resetTokens', 'token']);

export function createNormalizer({ since, knownSecrets = new Set() }) {
  const newIds = new Map();
  const secrets = new Map();
  const etags = new Map();
  const tag = (map, prefix, v) => {
    if (!map.has(v)) map.set(v, `<${prefix}:${map.size + 1}>`);
    return map.get(v);
  };
  const isNewOid = (s) => parseInt(s.slice(0, 8), 16) * 1000 >= since - 1000;
  const isRecent = (s) => {
    const t = Date.parse(s);
    return Number.isFinite(t) && t >= since - 60_000;
  };

  function jwt(token) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    } catch {
      return '<jwt invalide>';
    }
    const { iat, exp, nbf, ...rest } = claims;
    const ttl = iat && exp ? ` ttl=${exp - iat}` : '';
    return `<jwt ${JSON.stringify(sortKeys(value(rest)))}${ttl}>`;
  }

  function text(s) {
    return s
      .replace(JWT_IN_TEXT, (m) => jwt(m))
      .replace(OID_IN_TEXT, (m) => (isNewOid(m) ? tag(newIds, 'new-id', m) : m))
      .replace(ISO_IN_TEXT, (m) => (isRecent(m) ? '<now>' : m));
  }

  function value(v, key) {
    if (typeof v === 'string') {
      if (key === 'errorId') return '<errorId>';
      if (SECRET_KEYS.has(key) && v && !knownSecrets.has(v)) return tag(secrets, 'secret', v);
      if (OID.test(v)) return isNewOid(v) ? tag(newIds, 'new-id', v) : v;
      if (ISO.test(v) || HTTP_DATE.test(v)) return isRecent(v) ? '<now>' : v;
      if (JWT.test(v)) return jwt(v);
      return text(v);
    }
    if (Array.isArray(v)) return v.map((x) => value(x, key));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[text(k)] = value(v[k], k);
      return out;
    }
    return v;
  }

  // ETag des documents xAPI : sha1(uuid-horodatage), aléatoire à chaque écriture.
  const etag = (v) => tag(etags, 'etag', v);

  return { value, text, jwt, etag };
}

export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

// En-têtes conservés (les autres dépendent du serveur HTTP, pas du contrat).
const KEPT_HEADERS = [
  'content-type', 'content-disposition', 'location', 'etag', 'last-modified', 'www-authenticate',
  'x-frame-options', 'x-experience-api-version', 'x-experience-api-consistent-through',
  'access-control-allow-origin',
];

// L'ETag n'est conservé que pour le xAPI (préconditions sur les documents) : côté API, c'est
// l'ETag faible d'Express, empreinte du corps brut, qui change avec les dates et les identifiants.
export function normalizeHeaders(headers, n, { etag = false } = {}) {
  const out = {};
  for (const name of KEPT_HEADERS) {
    if (name === 'etag' && !etag) continue;
    const v = headers.get(name);
    if (v == null) continue;
    if (name === 'etag' && v.startsWith('W/')) continue; // ETag faible : empreinte du corps brut
    if (name === 'etag') { out[name] = n.etag(v); continue; }
    if (name === 'content-type') out[name] = v.toLowerCase().replace(/\s+/g, '').replace(/boundary=[^;]+/, 'boundary=<boundary>');
    else out[name] = n.value(v, name);
  }
  const cookies = headers.getSetCookie?.() ?? [];
  if (cookies.length) {
    out['set-cookie'] = cookies.map((c) => {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = n.text(pair.slice(0, eq));
      const val = pair.slice(eq + 1);
      const attributes = attrs
        .map((a) => (/^expires=/i.test(a) ? 'Expires=<date>' : a))
        .sort();
      return { name, value: val ? n.value(decodeURIComponent(val)) : '', attributes };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

// Corps : JSON si possible, texte sinon, empreinte pour le binaire.
export async function normalizeBody(res, buf, n, { mode = 'full' } = {}) {
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (mode === 'none') return { kind: 'ignored' };
  if (mode === 'hash' || /image\/|octet-stream|application\/zip|application\/pdf/.test(type)) {
    const { createHash } = await import('node:crypto');
    return { kind: 'binary', sha256: createHash('sha256').update(buf).digest('hex'), length: buf.length };
  }
  let s = buf.toString('utf8');
  const boundary = /boundary=([^;]+)/.exec(type)?.[1]?.replace(/"/g, '');
  if (boundary) s = s.split(boundary).join('<boundary>');
  if (mode === 'html') return { kind: 'html', length: s.length, tokens: [...new Set(s.match(JWT_IN_TEXT) ?? [])].map((t) => n.jwt(t)) };
  if (s === '') return { kind: 'empty' };
  try {
    return { kind: 'json', json: n.value(JSON.parse(s)) };
  } catch {
    return { kind: 'text', text: n.text(s) };
  }
}

// Chemins de la forme '/result/*/value' ('' = racine) ; '*' parcourt un tableau ou un objet.
function visit(node, parts, fn) {
  if (!parts.length) return fn(node);
  if (node == null || typeof node !== 'object') return node;
  const [head, ...rest] = parts;
  const keys = head === '*' ? Object.keys(node) : [head];
  for (const k of keys) if (k in node) node[k] = visit(node[k], rest, fn);
  return node;
}
const split = (path) => path.split('/').filter(Boolean);

// mask : valeurs arbitraires par nature (ex. $first sans tri) → '<masked>'
// unordered : tableaux dont l'ordre n'est pas garanti (ex-aequo d'un tri) → tri canonique
export function applyRules(json, { mask = [], unordered = [] } = {}) {
  let out = json;
  for (const p of unordered) {
    out = visit(out, split(p), (arr) => (Array.isArray(arr)
      ? [...arr].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : arr));
  }
  for (const p of mask) out = visit(out, split(p), (v) => (v === undefined ? v : '<masked>'));
  return out;
}
