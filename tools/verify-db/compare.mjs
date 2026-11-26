#!/usr/bin/env node
// Compare deux inventaires produits par inventory.js (ex. base legacy 4.2 et base restaurée 8.0).
// Signale : collections manquantes ou en trop, écarts de volumes, index absents ou différents,
// changements de types de champs. Code de sortie 1 en cas d'écart bloquant.
//
// Usage : node tools/verify-db/compare.mjs avant.json apres.json
import { readFileSync } from 'node:fs';

const [, , a, b] = process.argv;
if (!a || !b) {
  console.error('Usage : compare.mjs avant.json apres.json');
  process.exit(2);
}
const before = JSON.parse(readFileSync(a, 'utf8'));
const after = JSON.parse(readFileSync(b, 'utf8'));
const issues = [];
const notes = [];
const stable = (o) => JSON.stringify(o, Object.keys(o ?? {}).sort());
const ixSig = (ix) => JSON.stringify({ key: ix.key, unique: !!ix.unique, sparse: !!ix.sparse, ttl: ix.expireAfterSeconds ?? null, partial: ix.partialFilterExpression ?? null });

for (const [name, c1] of Object.entries(before.collections)) {
  const c2 = after.collections[name];
  if (!c2) { issues.push(`Collection absente après : ${name}`); continue; }
  if (c1.count !== c2.count) issues.push(`${name} : ${c1.count} documents avant, ${c2.count} après`);
  const ix2 = new Map(c2.indexes.map((ix) => [ix.name, ix]));
  for (const ix of c1.indexes) {
    const other = ix2.get(ix.name);
    if (!other) issues.push(`${name} : index absent après « ${ix.name} » ${JSON.stringify(ix.key)}`);
    else if (ixSig(ix) !== ixSig(other)) issues.push(`${name} : index « ${ix.name} » différent (${ixSig(ix)} → ${ixSig(other)})`);
  }
  for (const ix of c2.indexes) {
    if (!c1.indexes.some((i) => i.name === ix.name)) notes.push(`${name} : nouvel index « ${ix.name} » ${JSON.stringify(ix.key)}`);
  }
  for (const [field, t1] of Object.entries(c1.fieldTypes)) {
    const t2 = c2.fieldTypes[field];
    if (!t2) continue; // échantillonnage : un champ rare peut manquer
    const k1 = Object.keys(t1).sort().join(',');
    const k2 = Object.keys(t2).sort().join(',');
    if (k1 !== k2) notes.push(`${name}.${field} : types ${k1} → ${k2}`);
  }
}
for (const name of Object.keys(after.collections)) {
  if (!before.collections[name]) notes.push(`Nouvelle collection après : ${name}`);
}
if (stable(before.checks?.migrations?.map((m) => m.key)) !== stable(after.checks?.migrations?.map((m) => m.key).slice(0, before.checks?.migrations?.length))) {
  issues.push('Collection migrations : les clés historiques ou leur ordre ont changé');
}

console.log(`Avant : MongoDB ${before.server}, ${Object.keys(before.collections).length} collections`);
console.log(`Après : MongoDB ${after.server}, ${Object.keys(after.collections).length} collections\n`);
notes.forEach((n) => console.log(`  note  ${n}`));
issues.forEach((i) => console.log(`  ÉCART ${i}`));
console.log(issues.length ? `\n${issues.length} écart(s) bloquant(s).` : '\nAucun écart bloquant.');
process.exit(issues.length ? 1 : 0);
