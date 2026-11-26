#!/usr/bin/env node
// Compare deux enregistrements golden (référence legacy et candidat), cas par cas.
//
// Usage : node tools/golden/diff.mjs <référence> <candidat> [--only préfixe] [--max 50]
//         [--accept fichier.json]  liste d'identifiants dont l'écart est accepté (anomalies corrigées, D7)
// Code de sortie : 0 si aucun écart non accepté, 1 sinon.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : def; };
const only = opt('only', '');
const max = Number(opt('max', 50));
const acceptFile = opt('accept', null);
const [refDir, candDir] = args;
if (!refDir || !candDir) {
  console.error('Usage : diff.mjs <référence> <candidat> [--only préfixe] [--max n] [--accept fichier]');
  process.exit(2);
}
const accepted = new Set(acceptFile && existsSync(acceptFile) ? JSON.parse(readFileSync(acceptFile, 'utf8')) : []);
const load = (dir) => new Map(readFileSync(join(dir, 'cases.ndjson'), 'utf8').split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).filter((c) => c.id.startsWith(only)).map((c) => [c.id, c]));
const ref = load(refDir);
const cand = load(candDir);

// Différences en chemins JSON (premières seulement)
function diffs(a, b, path = '', out = []) {
  if (out.length >= 8) return out;
  if (isDeepStrictEqual(a, b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diffs(a[k], b[k], `${path}/${k}`, out);
    return out;
  }
  const show = (v) => (v === undefined ? '(absent)' : JSON.stringify(v)?.slice(0, 160));
  out.push(`${path || '/'} : ${show(a)} → ${show(b)}`);
  return out;
}

let same = 0; let differ = 0; let acceptedCount = 0; let shown = 0;
const missing = []; const extra = []; const bySection = {};
for (const [id, r] of ref) {
  const c = cand.get(id);
  if (!c) { missing.push(id); continue; }
  const d = diffs(r.response, c.response);
  if (!d.length) { same += 1; continue; }
  if (accepted.has(id)) { acceptedCount += 1; continue; }
  differ += 1;
  const section = id.split('.').slice(0, 2).join('.');
  bySection[section] = (bySection[section] ?? 0) + 1;
  if (shown < max) {
    shown += 1;
    console.log(`\n✗ ${id}  ${r.request.method} ${r.request.path}`);
    d.forEach((l) => console.log(`    ${l}`));
  }
}
for (const id of cand.keys()) if (!ref.has(id)) extra.push(id);

console.log(`\nIdentiques : ${same} / ${ref.size}   Écarts : ${differ}   Acceptés : ${acceptedCount}   Absents : ${missing.length}   En plus : ${extra.length}`);
if (Object.keys(bySection).length) console.log('Écarts par section :', JSON.stringify(bySection));
if (missing.length) console.log('Absents du candidat :', missing.slice(0, 20).join(', '), missing.length > 20 ? '…' : '');
process.exit(differ || missing.length ? 1 : 0);
