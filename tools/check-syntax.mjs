#!/usr/bin/env node
// Vérifie la syntaxe de tous les scripts de tools/ (node --check) et des scripts shell (bash -n).
// Ces scripts tournent sur la VM ou dans l'image legacy : la CI ne peut pas les exécuter, mais elle
// détecte au moins une erreur de syntaxe avant qu'ils y soient copiés.
import { readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(import.meta.dirname);
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => join(d.parentPath, d.name));

let failed = 0;
let checked = 0;
for (const file of files) {
  const ext = extname(file);
  const cmd = ext === '.sh' ? ['bash', ['-n', file]] : ['.js', '.mjs'].includes(ext) ? [process.execPath, ['--check', file]] : null;
  if (!cmd) continue;
  checked += 1;
  const res = spawnSync(cmd[0], cmd[1], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed += 1;
    console.error(`✗ ${file}\n${res.stderr}`);
  }
}
console.log(failed ? `${failed} fichier(s) en erreur` : `${checked} scripts vérifiés, syntaxe correcte`);
process.exit(failed ? 1 : 0);
