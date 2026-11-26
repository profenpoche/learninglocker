// Test différentiel : pipelines du portage TypeScript comparés, au caractère près (ordre des clés
// compris), à ceux du vrai code du front React legacy. Référence : test/fixtures/visualisation-pipelines.json.gz,
// produite par tools/oracle/pipelines.mjs (voir son en-tête pour la régénérer).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildVisualisationPipelines } from './build.js';

interface OracleCase {
  id: string;
  input: {
    visualisation: Record<string, unknown>;
    orgTimezone?: string;
    now: string;
    dashboardFilter?: unknown;
  };
  output?: unknown;
  error?: string;
}

interface OracleFile {
  meta: { cases: number; coverage: Record<string, Record<string, number>> };
  cases: OracleCase[];
}

const fixture = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'visualisation-pipelines.json.gz');
const oracle = JSON.parse(gunzipSync(readFileSync(fixture)).toString('utf8')) as OracleFile;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const show = (value: unknown): string => {
  const text = JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};

/** Premier chemin où deux valeurs JSON diffèrent (ordre des clés compris), ou null si identiques. */
export const firstDifference = (expected: unknown, actual: unknown, path = '$'): string | null => {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    for (let i = 0; i < Math.max(expected.length, actual.length); i += 1) {
      if (i >= expected.length) return `${path}[${String(i)}] : élément en trop ${show(actual[i])}`;
      if (i >= actual.length) return `${path}[${String(i)}] : élément manquant ${show(expected[i])}`;
      const diff = firstDifference(expected[i], actual[i], `${path}[${String(i)}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (isObject(expected) && isObject(actual)) {
    const ek = Object.keys(expected);
    const ak = Object.keys(actual);
    for (let i = 0; i < Math.max(ek.length, ak.length); i += 1) {
      const e = ek[i];
      const a = ak[i];
      if (e !== a) return `${path} : clé n°${String(i)} attendue ${show(e)}, obtenue ${show(a)} (clés attendues ${show(ek)}, obtenues ${show(ak)})`;
      if (e === undefined) continue;
      const diff = firstDifference(expected[e], actual[e], `${path}.${e}`);
      if (diff) return diff;
    }
    return null;
  }
  return JSON.stringify(expected) === JSON.stringify(actual) ? null : `${path} : attendu ${show(expected)}, obtenu ${show(actual)}`;
};

const run = (c: OracleCase): unknown => buildVisualisationPipelines(c.input.visualisation, {
  now: c.input.now,
  orgTimezone: c.input.orgTimezone,
  dashboardFilter: c.input.dashboardFilter,
});

describe('oracle des pipelines de visualisation', () => {
  it('contient plusieurs milliers de cas, dont des échecs du front d\'origine', () => {
    expect(oracle.cases.length).toBe(oracle.meta.cases);
    expect(oracle.cases.length).toBeGreaterThan(5000);
    expect(oracle.cases.some((c) => c.error !== undefined)).toBe(true);
  });

  // Un test par catégorie de cas (préfixe de l'id : real, template, chart, counter, xvsy, random, dates, edge).
  const categories = [...new Set(oracle.cases.map((c) => c.id.split('/')[0] ?? ''))];

  it.for(categories)('reproduit à l\'identique (JSON.stringify) les cas « %s »', { timeout: 60_000 }, (category) => {
    const cases = oracle.cases.filter((c) => c.id.startsWith(`${category}/`));
    const failures: string[] = [];
    let identical = 0;
    for (const c of cases) {
      let actual: unknown;
      try {
        actual = run(c);
      } catch (err) {
        if (c.error !== undefined) identical += 1;
        else failures.push(`${c.id} : exception ${String(err)}`);
        continue;
      }
      if (c.error !== undefined) {
        failures.push(`${c.id} : le front d'origine échoue (${c.error}), le portage renvoie ${show(actual)}`);
        continue;
      }
      if (JSON.stringify(actual) === JSON.stringify(c.output)) {
        identical += 1;
        continue;
      }
      failures.push(`${c.id} : ${firstDifference(c.output, JSON.parse(JSON.stringify(actual))) ?? 'différence de sérialisation'}`);
    }
    const report = `${category} : ${String(identical)} / ${String(cases.length)} cas identiques\n${failures.slice(0, 20).join('\n')}`;
    expect(failures, report).toEqual([]);
    expect(identical).toBe(cases.length);
  });

  it('couvre tous les cas du fichier', () => {
    expect(categories.reduce((total, category) => total + oracle.cases.filter((c) => c.id.startsWith(`${category}/`)).length, 0)).toBe(oracle.cases.length);
  });
});

describe('firstDifference', () => {
  it('signale un ordre de clés différent', () => {
    expect(firstDifference({ a: 1, b: 2 }, { b: 2, a: 1 })).toMatch(/^\$ : clé n°0/);
  });

  it('donne le chemin de la première valeur différente', () => {
    expect(firstDifference([{ $match: { x: [1, 2] } }], [{ $match: { x: [1, 3] } }])).toBe('$[0].$match.x[1] : attendu 2, obtenu 3');
    expect(firstDifference({ a: [1] }, { a: [1] })).toBeNull();
  });
});
