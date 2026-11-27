// Ordre d'itération d'un Set (ou des clés d'une Map) Immutable 3.8.2 après une suite d'ajouts et de
// suppressions, et égalité/hachage de valeurs Immutable. Sert à reproduire l'ordre des listes produites
// par le front (generateNewScopes → Set.toList(), reviver du schéma export → toSet()).
//
// Modèle (immutable/dist/immutable.js) :
// - tant que la Map n'a jamais dépassé 8 entrées, c'est un ArrayMapNode : ajout en fin, suppression
//   par « remplacer par la dernière » (newEntries[idx] = newEntries.pop()) ;
// - au 9e ajout, createNodes construit un HAMT en insérant la nouvelle clé PUIS les 8 existantes ;
//   l'itération suit alors les fragments de 5 bits du hash (poids faible d'abord) et, à hash égal
//   (HashCollisionNode), l'ordre de la liste de collision (ajout en fin, suppression par
//   « remplacer par la dernière ») ; le HAMT ne redevient jamais un ArrayMapNode, sauf vidé.

import { hashString, isList, isMap, toJS } from './visualisations/immutable.js';

const MAX_ARRAY_MAP_SIZE = 8;

const compareHashes = (ha: number, hb: number): number => {
  for (let shift = 0; shift <= 30; shift += 5) {
    const diff = ((ha >>> shift) & 31) - ((hb >>> shift) & 31);
    if (diff !== 0) return diff;
  }
  return 0;
};

export interface HashOps<T> {
  hash: (value: T) => number;
  equals: (a: T, b: T) => boolean;
}

const removeSwapLast = (list: unknown[], index: number): void => {
  const last = list.pop();
  if (index < list.length && last !== undefined) list[index] = last;
};

/** Set Immutable : valeurs distinctes (égalité Immutable), ordre d'itération reproduit. */
export class ImmutableSet<T> {
  private array: T[] | null = [];
  private readonly groups = new Map<number, T[]>();

  constructor(private readonly ops: HashOps<T>, values: Iterable<T> = []) {
    for (const value of values) this.add(value);
  }

  get size(): number {
    if (this.array) return this.array.length;
    let total = 0;
    for (const group of this.groups.values()) total += group.length;
    return total;
  }

  private indexIn(list: readonly T[], value: T): number {
    return list.findIndex((item) => this.ops.equals(value, item));
  }

  has(value: T): boolean {
    if (this.array) return this.indexIn(this.array, value) !== -1;
    const group = this.groups.get(this.ops.hash(value));
    return group ? this.indexIn(group, value) !== -1 : false;
  }

  add(value: T): this {
    if (this.has(value)) return this;
    if (this.array) {
      if (this.array.length < MAX_ARRAY_MAP_SIZE) {
        this.array.push(value);
        return this;
      }
      const previous = this.array;
      this.array = null;
      for (const item of [value, ...previous]) this.pushGroup(item);
      return this;
    }
    this.pushGroup(value);
    return this;
  }

  remove(value: T): this {
    if (this.array) {
      const index = this.indexIn(this.array, value);
      if (index !== -1) removeSwapLast(this.array, index);
      return this;
    }
    const hash = this.ops.hash(value);
    const group = this.groups.get(hash);
    if (!group) return this;
    const index = this.indexIn(group, value);
    if (index === -1) return this;
    removeSwapLast(group, index);
    if (group.length === 0) this.groups.delete(hash);
    if (this.groups.size === 0) this.array = [];
    return this;
  }

  /** Set.union(...autres) : nouveau Set. */
  union(...others: readonly ImmutableSet<T>[]): ImmutableSet<T> {
    const nonEmpty = others.filter((other) => other.size !== 0);
    if (nonEmpty.length === 0) return this.clone();
    if (this.size === 0 && nonEmpty.length === 1) return (nonEmpty[0] as ImmutableSet<T>).clone();
    const out = this.clone();
    for (const other of nonEmpty) for (const value of other.values()) out.add(value);
    return out;
  }

  /** Set.subtract(...autres) : parcourt ce Set et retire les valeurs présentes ailleurs. */
  subtract(...others: readonly ImmutableSet<T>[]): ImmutableSet<T> {
    if (others.length === 0) return this.clone();
    const out = this.clone();
    for (const value of this.values()) {
      if (others.some((other) => other.has(value))) out.remove(value);
    }
    return out;
  }

  /** Ordre d'itération (forEach, toList, toJS). */
  values(): T[] {
    if (this.array) return [...this.array];
    return [...this.groups.entries()].sort(([ha], [hb]) => compareHashes(ha, hb)).flatMap(([, group]) => group);
  }

  /** Set.toJS() : tableau, dans l'ordre d'itération. */
  toJS(): unknown[] {
    return this.values().map((value) => toJS(value));
  }

  clone(): ImmutableSet<T> {
    const out = new ImmutableSet<T>(this.ops);
    out.array = this.array ? [...this.array] : null;
    for (const [hash, group] of this.groups) out.groups.set(hash, [...group]);
    return out;
  }

  private pushGroup(value: T): void {
    const hash = this.ops.hash(value);
    const group = this.groups.get(hash);
    if (group) group.push(value);
    else this.groups.set(hash, [value]);
  }
}

const STRING_OPS: HashOps<string> = { hash: hashString, equals: (a, b) => a === b };

/** Set Immutable de chaînes. */
export class ImmutableStringSet extends ImmutableSet<string> {
  constructor(values: Iterable<string> = []) {
    super(STRING_OPS, values);
  }

  override union(...others: readonly ImmutableSet<string>[]): ImmutableStringSet {
    return ImmutableStringSet.from(super.union(...others));
  }

  override subtract(...others: readonly ImmutableSet<string>[]): ImmutableStringSet {
    return ImmutableStringSet.from(super.subtract(...others));
  }

  private static from(set: ImmutableSet<string>): ImmutableStringSet {
    const out = new ImmutableStringSet();
    Object.assign(out, set);
    return out;
  }
}

// --- Hachage et égalité de valeurs Immutable émulées (voir visualisations/immutable.ts) --------------

/** OrderedMap émulées (objets sans prototype dont l'ordre d'insertion est conservé). */
export const ORDERED_MAPS = new WeakSet<object>();

const smi = (i32: number): number => ((i32 >>> 1) & 0x40000000) | (i32 & 0xbfffffff);

const hashNumber = (value: number): number => {
  if (Number.isNaN(value) || value === Infinity) return 0;
  let h = value | 0;
  if (h !== value) h ^= value * 0xffffffff;
  let o = value;
  while (o > 0xffffffff) {
    o /= 0xffffffff;
    h ^= o;
  }
  return smi(h);
};

// hashMerge d'Immutable, à l'identique : a ^ (b + 0x9E3779B9 + (a << 6) + (a >> 2)), ramené en int32.
const hashMerge = (a: number, b: number): number => (a ^ (b + 0x9e3779b9 + (a << 6) + (a >> 2))) | 0;

const murmurHashOfSize = (size: number, h0: number): number => {
  let h = Math.imul(h0, 0xcc9e2d51);
  h = Math.imul((h << 15) | (h >>> 17), 0x1b873593);
  h = Math.imul((h << 13) | (h >>> 19), 5);
  h = ((h + 0xe6546b64) | 0) ^ size;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return smi(h ^ (h >>> 16));
};

/** hash() d'Immutable pour une valeur émulée (scalaires, Map, OrderedMap, List, Set). */
export const hashValue = (value: unknown): number => {
  if (value === false || value === null || value === undefined) return 0;
  if (value === true) return 1;
  if (typeof value === 'number') return hashNumber(value);
  if (typeof value === 'string') return hashString(value);
  if (isList(value)) {
    let h = 1;
    for (const item of value) h = (31 * h + hashValue(item)) | 0;
    return murmurHashOfSize(value.length, h);
  }
  if (value instanceof ImmutableSet) {
    let h = 0;
    for (const item of value.values() as unknown[]) h = (h + hashValue(item)) | 0;
    return murmurHashOfSize(value.size, h);
  }
  if (isMap(value)) {
    const ordered = ORDERED_MAPS.has(value);
    let h = ordered ? 1 : 0;
    const keys = Object.keys(value);
    for (const key of keys) {
      const merged = hashMerge(hashValue(value[key]), hashString(key));
      h = ordered ? (31 * h + merged) | 0 : (h + merged) | 0;
    }
    return murmurHashOfSize(keys.length, h);
  }
  throw new TypeError('hash Immutable : valeur non prise en charge (objet brut)');
};

/** is() d'Immutable : égalité de valeur (profonde pour les collections). */
export const immutableIs = (a: unknown, b: unknown): boolean => {
  if (a === b || (a !== a && b !== b)) return true;
  if (!a || !b) return false;
  if (isList(a) || isList(b)) {
    return isList(a) && isList(b) && a.length === b.length && a.every((item, i) => immutableIs(item, b[i]));
  }
  if (a instanceof ImmutableSet || b instanceof ImmutableSet) {
    return a instanceof ImmutableSet && b instanceof ImmutableSet && a.size === b.size && (b.values() as unknown[]).every((item) => (a as ImmutableSet<unknown>).has(item));
  }
  if (isMap(a) && isMap(b)) {
    if (ORDERED_MAPS.has(a) !== ORDERED_MAPS.has(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    if (ORDERED_MAPS.has(a)) return kb.every((key, i) => ka[i] === key && immutableIs(a[key], b[key]));
    return kb.every((key) => Object.hasOwn(a, key) && immutableIs(a[key], b[key]));
  }
  return false;
};

/** Opérations de Set Immutable sur des valeurs émulées. */
export const VALUE_OPS: HashOps<unknown> = { hash: hashValue, equals: immutableIs };
