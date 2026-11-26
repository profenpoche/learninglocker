// Encodage des points dans les clés : MongoDB refuse « . » dans un nom de champ, Learning Locker
// le remplace par « &46; » à l'écriture (extensions xAPI, métadonnées) et le restaure à la lecture.
// Contrat de données : docs/02-donnees.md. Code d'origine : legacy/lib/helpers/encodeDot.js,
// legacy/lib/helpers/decodeDot.js, legacy/lib/models/statement.js (mapDot).

const ENCODED_DOT = '&46;';

/** Remplace chaque « . » par « &46; ». */
export const encodeDot = (value: string): string => value.replaceAll('.', ENCODED_DOT);

/** Remplace chaque « &46; » par « . ». */
export const decodeDot = (value: string): string => value.replaceAll(ENCODED_DOT, '.');

// Équivalent de lodash.isPlainObject : seuls les objets littéraux sont parcourus ;
// ObjectId, Date, Buffer… sont renvoyés tels quels.
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/**
 * Applique `converter` à toutes les clés, récursivement (objets simples et tableaux).
 * Les valeurs ne sont jamais modifiées. Par défaut, décode (`decodeDot`).
 */
export const mapDot = <T = unknown>(data: T, converter: (key: string) => string = decodeDot): T => {
  if (isPlainObject(data)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      out[converter(key)] = mapDot(value, converter);
    }
    return out as T;
  }
  if (Array.isArray(data)) {
    return data.map((value: unknown) => mapDot(value, converter)) as T;
  }
  return data;
};
