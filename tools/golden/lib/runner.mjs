// Exécution du scénario : profils d'authentification, requêtes, enregistrement normalisé.
import { createHmac } from 'node:crypto';
import { createWriteStream, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createNormalizer, normalizeHeaders, normalizeBody, sortKeys, applyRules } from './normalize.mjs';

const b64 = (s) => Buffer.from(s).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// JWT HS256 signé avec APP_SECRET : sert à fabriquer des jetons expirés ou mal signés.
export function signJwt(payload, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export const decodeJwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

export async function createRunner({ base, ui = base, manifest, out, presaveUrl, reference, appSecret }) {
  const since = Date.now();
  const knownSecrets = new Set(Object.values(manifest.clients).flatMap((c) => [c.key, c.secret]));
  const n = createNormalizer({ since, knownSecrets });
  const cases = createWriteStream(join(out, 'cases.ndjson'));
  const raw = createWriteStream(join(out, 'raw.ndjson'));
  const ids = new Set();
  const auth = { anon: {} };
  const cookies = {};
  const stats = { total: 0, byStatus: {}, sections: {} };
  // Pipelines du front : calculés par le service presave à l'enregistrement, relus ensuite.
  const pipelinesFile = reference ? join(reference, 'pipelines.json') : null;
  const pipelinesRef = pipelinesFile && existsSync(pipelinesFile) ? JSON.parse(readFileSync(pipelinesFile, 'utf8')) : null;
  const pipelines = {};

  function setAuth(name, spec) { auth[name] = spec; }

  function headersFor(as, extra = {}) {
    const spec = auth[as];
    if (!spec) throw new Error(`Profil inconnu : ${as}`);
    const h = { ...extra };
    if (spec.bearer) h.Authorization = `Bearer ${spec.bearer}`;
    if (spec.basic) h.Authorization = `Basic ${b64(spec.basic)}`;
    if (spec.header) h.Authorization = spec.header;
    if (spec.cookie) h.Cookie = spec.cookie;
    return h;
  }

  function buildUrl(root, path, query) {
    const url = new URL(path, root);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    return url;
  }

  /**
   * Exécute et enregistre une requête.
   * spec : { as, method, path, query, json, body, form, headers, xapi, ui, mode, poll }
   *   xapi : préfixe /data/xAPI et en-tête de version ; ui : requête sur le serveur du front
   *   mode : 'full' (défaut), 'status' (corps ignoré), 'hash', 'html'
   *   poll : { until: (res) => bool, every: ms, max: n } — rejoue jusqu'à la condition, n'enregistre que la dernière
   *   mask, unordered : chemins du corps JSON à masquer ou à trier (voir normalize.applyRules)
   * Renvoie { status, body (JSON brut ou texte), headers }.
   */
  async function req(id, spec) {
    if (ids.has(id)) throw new Error(`Identifiant de cas en double : ${id}`);
    ids.add(id);
    const { as = 'anon', method = 'GET', query, json, form, mode = 'full', poll } = spec;
    let path = spec.path;
    if (spec.xapi) path = `/data/xAPI${path}`;
    else if (!spec.ui && !path.startsWith('/api')) path = `/api${path}`;
    const url = buildUrl(spec.ui ? ui : base, path, query);
    const headers = headersFor(as, spec.headers);
    if (spec.xapi && !('X-Experience-API-Version' in headers) && spec.version !== false) headers['X-Experience-API-Version'] = '1.0.3';
    let body = spec.body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) {
      body = new FormData();
      for (const [k, v] of Object.entries(form)) {
        if (v && v.blob) body.append(k, v.blob, v.filename);
        else body.append(k, v);
      }
    }

    let res; let buf; let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(spec.timeout ?? 30_000) });
        buf = Buffer.from(await res.arrayBuffer());
      } catch (err) {
        if (err.name !== 'TimeoutError') throw err;
        // Pas de réponse : c'est aussi un comportement à comparer.
        const record = { id, request: { as, method, path: url.pathname }, response: { status: 'timeout' } };
        cases.write(`${JSON.stringify(record)}\n`);
        stats.total += 1;
        stats.byStatus.timeout = (stats.byStatus.timeout ?? 0) + 1;
        return { status: 'timeout', body: null, headers: new Headers(), buf: Buffer.alloc(0) };
      }
      if (!poll) break;
      const parsed = parse(buf);
      if (poll.until({ status: res.status, body: parsed }) || attempts >= (poll.max ?? 30)) break;
      await sleep(poll.every ?? 1000);
    }

    const parsed = parse(buf);
    const record = {
      id,
      request: n.value(sortKeys({
        as, method, path: url.pathname, query: Object.fromEntries(url.searchParams),
        ...(json !== undefined ? { json } : {}),
        ...(form ? { form: Object.keys(form) } : {}),
        ...(spec.headers ? { headers: spec.headers } : {}),
      })),
      response: {
        status: res.status,
        headers: normalizeHeaders(res.headers, n, { etag: Boolean(spec.xapi) }),
        body: mode === 'status' ? { kind: 'ignored' } : sortKeys(await normalizeBody(res, buf, n, { mode })),
      },
    };
    if (record.response.body.json !== undefined && (spec.mask || spec.unordered)) {
      record.response.body.json = applyRules(record.response.body.json, spec);
      record.rules = { mask: spec.mask, unordered: spec.unordered };
    }
    cases.write(`${JSON.stringify(record)}\n`);
    raw.write(`${JSON.stringify({ id, url: url.href, method, status: res.status, body: buf.length < 200_000 ? buf.toString('utf8') : `<${buf.length} octets>` })}\n`);
    stats.total += 1;
    stats.byStatus[res.status] = (stats.byStatus[res.status] ?? 0) + 1;
    const section = id.split('.').slice(0, 2).join('.');
    stats.sections[section] = (stats.sections[section] ?? 0) + 1;
    return { status: res.status, body: parsed, headers: res.headers, buf };
  }

  function parse(buf) {
    const s = buf.toString('utf8');
    try { return JSON.parse(s); } catch { return s; }
  }

  // Pipelines d'agrégation du front pour une visualisation (référence ou service presave).
  async function frontPipelines(key, body) {
    if (body.live) {
      // Calcul à l'instant présent : jamais relu d'une référence ; ignoré sans service presave.
      if (!presaveUrl) return null;
      const res = await fetch(`${presaveUrl}/pipelines`, { method: 'POST', body: JSON.stringify(body) });
      return res.ok ? res.json() : null;
    }
    if (pipelinesRef) {
      if (!(key in pipelinesRef)) throw new Error(`Pipelines absents de la référence : ${key}`);
      pipelines[key] = pipelinesRef[key];
      return pipelinesRef[key];
    }
    if (!presaveUrl) throw new Error('Service presave requis (PRESAVE) pour calculer les pipelines');
    const res = await fetch(`${presaveUrl}/pipelines`, { method: 'POST', body: JSON.stringify(body) });
    const outp = await res.json();
    if (!res.ok) throw new Error(`presave /pipelines ${key} : ${outp.error}`);
    pipelines[key] = outp;
    return outp;
  }

  async function close() {
    await Promise.all([new Promise((r) => cases.end(r)), new Promise((r) => raw.end(r))]);
    return { since, stats, pipelines };
  }

  return { req, setAuth, auth, cookies, frontPipelines, close, since, manifest, appSecret, sleep };
}
