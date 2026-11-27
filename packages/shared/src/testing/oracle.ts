// Outils des tests d'oracle (non publiés : exclus du build) : lecture des fixtures produites par
// tools/oracle/libs.mjs et sérialisation « étiquetée » identique à celle de
// tools/oracle/legacy/lib-oracle-server.js (tag()).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ObjectIdRef } from '../query/values.js';

export interface OracleCase<I = Record<string, unknown>> {
  id: string;
  input: I;
  output: unknown;
}

export interface OracleFile<I = Record<string, unknown>> {
  meta: { category: string; cases: number; description: string };
  cases: OracleCase<I>[];
}

export const loadOracle = <I = Record<string, unknown>>(name: string): OracleFile<I> =>
  JSON.parse(gunzipSync(readFileSync(join(import.meta.dirname, '..', '..', 'test', 'fixtures', `${name}.json.gz`))).toString('utf8')) as OracleFile<I>;

const objectTag = (value: object): string => Object.prototype.toString.call(value);

/** Sérialisation étiquetée : ObjectId, Date, Error, undefined, NaN… restent distinguables en JSON. */
export const tag = (value: unknown): unknown => {
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
  if (value instanceof ObjectIdRef && Object.hasOwn(value, 'hex')) return { $$oid: value.hex };
  const kind = objectTag(value);
  if (kind === '[object Date]') {
    const time = (value as Date).getTime();
    return { $$date: Number.isNaN(time) ? 'Invalid' : time };
  }
  if (kind === '[object Error]') return { $$error: { name: (value as Error).name, message: (value as Error).message } };
  if (Array.isArray(value)) return value.map(tag);
  const proto = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  const out: Record<string, unknown> = {};
  if (proto !== Object.prototype && proto !== null) {
    const name = proto.constructor?.name ?? Object.prototype.toString.call(proto);
    out.$$proto = name === 'ObjectIdRef' ? 'ObjectID' : name;
  }
  for (const key of Object.keys(value)) {
    Object.defineProperty(out, key, { value: tag((value as Record<string, unknown>)[key]), enumerable: true, configurable: true, writable: true });
  }
  return out;
};

const NATIVE_MESSAGE_ERRORS = new Set(['TypeError', 'SyntaxError', 'RangeError']);

/**
 * Les messages des erreurs natives (TypeError, SyntaxError…) diffèrent entre Node 10 (legacy) et
 * Node 24 : on ne compare que leur nom. Les autres messages (règles métier) sont comparés.
 */
export const normalizeErrors = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeErrors);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    Object.defineProperty(out, key, { value: normalizeErrors(record[key]), enumerable: true, configurable: true, writable: true });
  }
  // Forme { thrown: 'TypeError', message } des routes de validation.
  if (typeof record.thrown === 'string' && NATIVE_MESSAGE_ERRORS.has(record.thrown) && 'message' in record) out.message = '…';
  for (const key of ['$$error', '$$thrown']) {
    const error = record[key] as { name?: unknown; message?: unknown } | undefined;
    if (error && typeof error === 'object' && NATIVE_MESSAGE_ERRORS.has(String(error.name))) {
      out[key] = { name: error.name, message: '…' };
    }
  }
  return out;
};

/** Erreur levée par le portage, au format `{ $$thrown: { name, message } }` des fixtures. */
export const thrown = (err: unknown): unknown => ({ $$thrown: { name: (err as Error).name, message: (err as Error).message } });

const show = (value: unknown): string => {
  const text = JSON.stringify(value) as string | undefined ?? String(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Premier chemin où deux valeurs JSON diffèrent (ordre des clés compris), ou null. */
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
  if (isRecord(expected) && isRecord(actual)) {
    const ek = Object.keys(expected);
    const ak = Object.keys(actual);
    for (let i = 0; i < Math.max(ek.length, ak.length); i += 1) {
      const e = ek[i];
      if (e !== ak[i]) return `${path} : clé n°${String(i)} attendue ${show(e)}, obtenue ${show(ak[i])} (clés attendues ${show(ek)}, obtenues ${show(ak)})`;
      if (e === undefined) continue;
      const diff = firstDifference(expected[e], actual[e], `${path}.${e}`);
      if (diff) return diff;
    }
    return null;
  }
  return JSON.stringify(expected) === JSON.stringify(actual) ? null : `${path} : attendu ${show(expected)}, obtenu ${show(actual)}`;
};

/**
 * Compare chaque cas (JSON.stringify, après normalizeErrors des deux côtés) et renvoie la liste des
 * écarts « id : premier chemin qui diffère ».
 */
export const compareCases = async <I>(cases: readonly OracleCase<I>[], run: (input: I) => unknown): Promise<{ identical: number; failures: string[] }> => {
  const failures: string[] = [];
  let identical = 0;
  for (const c of cases) {
    let actual: unknown;
    try {
      actual = await run(c.input);
    } catch (err) {
      actual = thrown(err);
    }
    const expected = normalizeErrors(c.output);
    const got = normalizeErrors(JSON.parse(JSON.stringify(actual)) as unknown);
    if (JSON.stringify(expected) === JSON.stringify(got)) identical += 1;
    else failures.push(`${c.id} : ${firstDifference(expected, got) ?? 'différence de sérialisation'}`);
  }
  return { identical, failures };
};
