#!/usr/bin/env node
// Enregistre le scénario golden contre une pile Learning Locker (legacy ou 2026).
// La base doit être dans l'état exact de l'instantané (voir restore-legacy.sh).
//
// Usage : node tools/golden/record.mjs <dossier de sortie>
// Variables :
//   LL_BASE     URL publique (nginx), défaut http://localhost:18080
//   UI_BASE     URL du front pour les dashboards partagés, défaut = LL_BASE
//   MANIFEST    manifest.json de l'instantané, défaut ../snapshots/latest/manifest.json
//   PRESAVE     service presave (pipelines du front) ; sans lui, REFERENCE est obligatoire
//   REFERENCE   enregistrement de référence dont on relit pipelines.json
//   APP_SECRET  secret JWT de la pile (jetons expirés fabriqués)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from './lib/runner.mjs';
import scenario from './scenario.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? 'golden-out');
const base = process.env.LL_BASE ?? 'http://localhost:18080';
const manifestPath = process.env.MANIFEST ?? join(here, '..', 'snapshots', 'latest', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
mkdirSync(out, { recursive: true });

const R = await createRunner({
  base,
  ui: process.env.UI_BASE ?? base,
  manifest,
  out,
  presaveUrl: process.env.PRESAVE,
  reference: process.env.REFERENCE,
  appSecret: process.env.APP_SECRET ?? 'legacy-reference-secret-not-for-production-0123456789',
});

const started = new Date();
let failure = null;
try {
  await scenario(R);
} catch (err) {
  failure = err;
}
const { since, stats, pipelines } = await R.close();
writeFileSync(join(out, 'pipelines.json'), JSON.stringify(pipelines, null, 1));
writeFileSync(join(out, 'meta.json'), JSON.stringify({
  base, manifest: manifestPath, seed: manifest.seed, referenceDate: manifest.referenceDate,
  startedAt: started.toISOString(), since, durationMs: Date.now() - started.getTime(),
  stats, error: failure ? String(failure.stack ?? failure) : null,
}, null, 2));

console.log(`${stats.total} requêtes enregistrées dans ${out}`);
console.log('Statuts :', JSON.stringify(stats.byStatus));
if (failure) {
  console.error('Scénario interrompu :', failure);
  process.exit(1);
}
