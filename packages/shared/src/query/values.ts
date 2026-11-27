// Représentation des ObjectId et lecture des dates, pour les helpers de requête du serveur.
//
// ObjectId : la bibliothèque ne dépend d'aucun driver. Elle valide la valeur comme bson 1.1.3
// (mongoose.Types.ObjectId du legacy) puis délègue la création à une fabrique fournie par l'appelant
// (ex. `{ fromHex: (h) => new ObjectId(h), generate: (t) => new ObjectId(t) }` avec le paquet bson).
// Par défaut, ObjectIdRef : classe neutre { hex }, sérialisée en EJSON `{ "$oid": hex }`.
//
// Dates : objets Date natifs. Une chaîne sans décalage est lue en UTC, comme le serveur legacy
// (conteneur en UTC), et non dans le fuseau local du processus.

import { markOpaque } from './lodash.js';

/** ObjectId neutre (fabrique par défaut). */
export class ObjectIdRef {
  constructor(readonly hex: string) {}
  toHexString(): string { return this.hex; }
  toString(): string { return this.hex; }
  toJSON(): { $oid: string } { return { $oid: this.hex }; }
}

export interface ObjectIdFactory {
  /** ObjectId à partir de 24 caractères hexadécimaux en minuscules. */
  fromHex(hex: string): object;
  /** Nouvel ObjectId (bson : `ObjectId()` ou `ObjectId(nombre)`, l'horodatage valant alors ce nombre). */
  generate(time?: number): object;
}

const randomHex = (bytes: number): string => {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const defaultObjectIdFactory: ObjectIdFactory = {
  fromHex: (hex) => new ObjectIdRef(hex),
  generate: (time) => {
    const t = time ?? Math.floor(Date.now() / 1000);
    const head = [(t >> 24) & 0xff, (t >> 16) & 0xff, (t >> 8) & 0xff, t & 0xff].map((b) => b.toString(16).padStart(2, '0')).join('');
    return new ObjectIdRef(head + randomHex(8));
  },
};

const BSON_MESSAGE = 'Argument passed in must be a single String of 12 bytes or a string of 24 hex characters';
const HEX_24 = /^[0-9a-fA-F]{24}$/;

// bson 1.1.3 : hexTable[charCode] ; un caractère au-delà de 0xFF donne « undefined ».
const binaryStringToHex = (value: string): string => {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += code < 256 ? code.toString(16).padStart(2, '0') : 'undefined';
  }
  return out;
};

/**
 * `mongoose.Types.ObjectId(value)` (bson 1.1.3) : lève une erreur pour une valeur invalide.
 * - null, undefined, nombre : nouvel ObjectId (fabrique.generate) ;
 * - 24 caractères hexadécimaux : cet ObjectId (hexadécimal mis en minuscules) ;
 * - 12 caractères : leurs codes comme octets ;
 * - objet « ObjectId-like » (propriété toHexString et id de 12 ou 24 caractères) : renvoyé tel quel.
 */
export const toObjectId = (value: unknown, factory: ObjectIdFactory): unknown => {
  if (value === null || value === undefined) return markOpaque(factory.generate());
  if (typeof value === 'number') return markOpaque(factory.generate(value));
  if (typeof value === 'string') {
    if (value.length === 24 && HEX_24.test(value)) return markOpaque(factory.fromHex(value.toLowerCase()));
    if (value.length === 12) return markOpaque(factory.fromHex(binaryStringToHex(value)));
    throw new Error(BSON_MESSAGE);
  }
  if (typeof value === 'object' && (value as { toHexString?: unknown }).toHexString) {
    // ObjectID.isValid lit id.id.length (TypeError si id.id est absent).
    const id = (value as { id: { length: number } }).id;
    const valid = id.length === 12 || (id.length === 24 && typeof id === 'string' && HEX_24.test(id));
    if (!valid) throw new Error(BSON_MESSAGE);
    if ((value as { length?: unknown }).length === 12) {
      throw new Error('ObjectId à partir d’un objet de longueur 12 : non pris en charge');
    }
    return value;
  }
  throw new Error(BSON_MESSAGE);
};

// --- Dates ---------------------------------------------------------------------------------------

// Format date-heure ISO d'ECMAScript (Date.parse) : avec une heure et sans décalage, V8 lit l'heure
// locale ; on la lit en UTC.
const ISO_LOCAL_TIME = /^(?:[+-]\d{6}|\d{4})-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
// Formats non ISO : sans indication de fuseau, V8 lit l'heure locale.
const HAS_ZONE = /(?:\b(?:UTC|UT|GMT|Z|[ECMP][SD]T)\b|[+-]\d{2}:?\d{2}\b|\bT\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)/i;

/** `new Date(chaîne)` tel que l'évalue le serveur legacy (processus en UTC). */
export const parseDateString = (value: string): Date => {
  if (ISO_LOCAL_TIME.test(value)) return new Date(`${value}Z`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || /^(?:[+-]\d{6}|\d{4})(?:-\d{2}(?:-\d{2})?)?(?:T.*)?$/.test(value) || HAS_ZONE.test(value)) return date;
  // Chaîne non ISO sans fuseau : V8 l'a lue en heure locale ; on relit ses composantes en UTC.
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()));
};

/** `new Date(valeur)` du serveur legacy (chaînes : voir parseDateString). */
export const toDate = (value: unknown): Date => {
  if (typeof value === 'string') return parseDateString(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value !== null && typeof value === 'object') {
    // ToPrimitive (indice « default ») : valueOf, puis toString.
    const valueOf = (value as { valueOf?: unknown }).valueOf;
    const primitive: unknown = typeof valueOf === 'function' ? (valueOf as () => unknown).call(value) : value;
    if (primitive !== null && typeof primitive === 'object') {
      const toString = (value as { toString?: unknown }).toString;
      if (typeof toString !== 'function') throw new TypeError('Cannot convert object to primitive value');
      const text: unknown = (toString as () => unknown).call(value);
      if (text !== null && typeof text === 'object') throw new TypeError('Cannot convert object to primitive value');
      return toDate(text);
    }
    return toDate(primitive);
  }
  return new Date(value as number);
};
