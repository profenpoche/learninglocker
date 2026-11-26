// Document de visualisation stocké (champs JSON en chaîne) → modèle utilisé par le front.
// Code d'origine : legacy/ui/src/utils/schemas.js (reviver du schéma « visualisation »), appliqué par
// legacy/ui/src/redux/modules/models/entityReviver.js via Immutable.fromJS(document, reviver).

import { deserialiseAxesInternal } from './axes.js';
import { fromJS, isImmutablePlainObj, isMap, mapFromEntries, markRaw, toJS, type IMap } from './immutable.js';

// Une série stockée : chaîne JSON. Un JSON invalide donne {} (l'original journalise l'erreur).
const parseFilter = (query: unknown): unknown => {
  let parsedQuery: unknown = {};
  // L'original fait JSON.parse(String(valeur)) : une Map ou une List y donne « Map { … } », invalide.
  if (query === null || typeof query !== 'object') {
    try {
      parsedQuery = JSON.parse(String(query));
    } catch {
      parsedQuery = {};
    }
  }
  return fromJS(parsedQuery);
};

/**
 * Le reviver est appelé, des feuilles vers la racine, pour chaque objet ou tableau du document
 * (clé = nom du champ, ou indice dans un tableau ; '' pour la racine) :
 * - clé « filters » : chaque valeur est une série en chaîne JSON, parsée ;
 * - tableau : List ;
 * - objet : Map, `axes` parsé s'il est en chaîne, champs d'axes désérialisés (deserialiseAxes).
 * Un objet JSON avec une clé « constructor » n'est pas converti (isPlainObj) et le reviver ne le voit pas.
 */
const reviveNode = (json: unknown, key: string | number): unknown => {
  if (Array.isArray(json)) {
    const children = json.map((item: unknown, index) => reviveNode(item, index));
    if (key === 'filters') return children.map(parseFilter);
    return children;
  }
  if (json !== null && typeof json === 'object') {
    if (!isImmutablePlainObj(json)) {
      markRaw(json);
      return json;
    }
    const source = json as Record<string, unknown>;
    const keys = Object.keys(source);
    const children = keys.map((childKey) => [childKey, reviveNode(source[childKey], childKey)] as const);
    if (key === 'filters') return children.map(([, child]) => parseFilter(child));

    const out = mapFromEntries(children);
    const axes = out.axes;
    if (typeof axes === 'string') {
      out.axes = fromJS(JSON.parse(axes));
    }
    return deserialiseAxesInternal(out);
  }
  return json;
};

/** Version interne : renvoie le modèle en Map émulées (voir immutable.ts). */
export const reviveVisualisationInternal = (document: unknown): unknown => reviveNode(document, '');

/**
 * Transforme un document de visualisation tel que stocké (ou renvoyé par l'API) en modèle :
 * `filters` devient une liste d'objets `{ $match, label?, color? }`, les champs `axesgroup`,
 * `axesvalue`, `axesxValue`, `axesyValue`, `axesxQuery`, `axesyQuery`, `axesquery` et `axes`
 * deviennent des objets. Les autres champs sont inchangés.
 * Lève une SyntaxError si un champ d'axes contient un JSON invalide (comme le front d'origine).
 */
export const reviveVisualisation = (document: Record<string, unknown>): Record<string, unknown> => {
  const revived = reviveVisualisationInternal(document);
  if (!isMap(revived)) throw new TypeError('visualisation doit être un objet');
  return toJS(revived) as Record<string, unknown>;
};

export type { IMap };
