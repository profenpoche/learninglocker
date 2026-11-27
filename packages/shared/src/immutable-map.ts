// Map Immutable 3.8.2 à clés quelconques (dont des Map et List émulées), avec l'ordre d'itération exact
// après ajouts, remplacements et suppressions. Même modèle que immutable-set.ts (ArrayMapNode puis HAMT).
// Sert aux « criteria » du query builder (clé = Map { criterionLabel, criteriaPath }).

import { VALUE_OPS, type HashOps } from './immutable-set.js';

const MAX_ARRAY_MAP_SIZE = 8;

const compareHashes = (ha: number, hb: number): number => {
  for (let shift = 0; shift <= 30; shift += 5) {
    const diff = ((ha >>> shift) & 31) - ((hb >>> shift) & 31);
    if (diff !== 0) return diff;
  }
  return 0;
};

type Entry<K, V> = [K, V];

const removeSwapLast = (list: unknown[], index: number): void => {
  const last = list.pop();
  if (index < list.length && last !== undefined) list[index] = last;
};

export class ImmutableMapSim<K = unknown, V = unknown> {
  private array: Entry<K, V>[] | null = [];
  private readonly groups = new Map<number, Entry<K, V>[]>();

  constructor(private readonly ops: HashOps<K> = VALUE_OPS, entries: Iterable<readonly [K, V]> = []) {
    for (const [key, value] of entries) this.set(key, value);
  }

  get size(): number {
    if (this.array) return this.array.length;
    let total = 0;
    for (const group of this.groups.values()) total += group.length;
    return total;
  }

  private find(key: K): Entry<K, V> | undefined {
    const list = this.array ?? this.groups.get(this.ops.hash(key)) ?? [];
    return list.find(([k]) => this.ops.equals(key, k));
  }

  has(key: K): boolean { return this.find(key) !== undefined; }

  get(key: K, notSetValue?: V): V | undefined {
    const entry = this.find(key);
    return entry ? entry[1] : notSetValue;
  }

  /** map.set(key, value) : une clé existante garde sa place. Modifie et renvoie this. */
  set(key: K, value: V): this {
    const entry = this.find(key);
    if (entry) {
      entry[1] = value;
      return this;
    }
    if (this.array) {
      if (this.array.length < MAX_ARRAY_MAP_SIZE) {
        this.array.push([key, value]);
        return this;
      }
      const previous = this.array;
      this.array = null;
      for (const item of [[key, value] as Entry<K, V>, ...previous]) this.pushGroup(item);
      return this;
    }
    this.pushGroup([key, value]);
    return this;
  }

  /** map.remove(key). Modifie et renvoie this. */
  remove(key: K): this {
    if (this.array) {
      const index = this.array.findIndex(([k]) => this.ops.equals(key, k));
      if (index !== -1) removeSwapLast(this.array, index);
      return this;
    }
    const hash = this.ops.hash(key);
    const group = this.groups.get(hash);
    if (!group) return this;
    const index = group.findIndex(([k]) => this.ops.equals(key, k));
    if (index === -1) return this;
    removeSwapLast(group, index);
    if (group.length === 0) this.groups.delete(hash);
    if (this.groups.size === 0) this.array = [];
    return this;
  }

  /** Entrées dans l'ordre d'itération. */
  entries(): Entry<K, V>[] {
    const list = this.array ?? [...this.groups.entries()].sort(([ha], [hb]) => compareHashes(ha, hb)).flatMap(([, group]) => group);
    return list.map(([k, v]) => [k, v]);
  }

  clone(): ImmutableMapSim<K, V> {
    const out = new ImmutableMapSim<K, V>(this.ops);
    out.array = this.array ? this.array.map(([k, v]) => [k, v]) : null;
    for (const [hash, group] of this.groups) out.groups.set(hash, group.map(([k, v]) => [k, v]));
    return out;
  }

  /** Nouvelle Map construite en réinsérant les entrées retenues (reify de filter/map d'Immutable). */
  rebuild<W>(fn: (entries: Entry<K, V>[]) => Entry<K, W>[]): ImmutableMapSim<K, W> {
    return new ImmutableMapSim<K, W>(this.ops, fn(this.entries()));
  }

  private pushGroup(entry: Entry<K, V>): void {
    const hash = this.ops.hash(entry[0]);
    const group = this.groups.get(hash);
    if (group) group.push(entry);
    else this.groups.set(hash, [entry]);
  }
}
