// Champs « axes* » des visualisations : dépliage et désérialisation.
// Code d'origine : legacy/lib/helpers/visualisation.js.

import { VISUALISE_AXES_PREFIX } from './constants.js';
import { fromJS, isMap, mapFromEntries, toJS, type IMap } from './immutable.js';

/** Champs d'axes stockés en chaîne JSON. */
export const axesToJsList: readonly string[] = ['axesgroup', 'axesxValue', 'axesyValue', 'axesvalue', 'axesxQuery', 'axesyQuery', 'axesquery'];

/** Version interne (Map émulées) de unflattenAxes. */
export const unflattenAxesInternal = (visualisation: IMap): IMap =>
  mapFromEntries(
    Object.keys(visualisation)
      .filter((key) => key.startsWith(VISUALISE_AXES_PREFIX) && key.length > VISUALISE_AXES_PREFIX.length)
      .map((key) => [key.slice(VISUALISE_AXES_PREFIX.length), visualisation[key]]),
  );

/**
 * Garde les champs « axes<Nom> » et retire le préfixe : `{ axesxLabel, axesgroup, type }` donne
 * `{ xLabel, group }`. Le champ obsolète `axes` (sans suffixe) est ignoré.
 */
export const unflattenAxes = (visualisation: Record<string, unknown>): Record<string, unknown> => {
  const map = fromJS(visualisation);
  if (!isMap(map)) throw new TypeError('visualisation doit être un objet');
  return toJS(unflattenAxesInternal(map)) as Record<string, unknown>;
};

/**
 * Version interne de deserialiseAxes : modifie `visualisation` sur place (Map.merge garde la position
 * des clés existantes) et la renvoie. Un JSON invalide lève une SyntaxError, comme à l'origine.
 */
export const deserialiseAxesInternal = (visualisation: IMap, keyPrefix = ''): IMap => {
  const parsed: [string, unknown][] = [];
  for (const key of Object.keys(visualisation)) {
    const item = visualisation[key];
    if (typeof item === 'string' && axesToJsList.includes(keyPrefix + key)) {
      parsed.push([key, fromJS(JSON.parse(item))]);
    }
  }
  for (const [key, item] of parsed) visualisation[key] = item;
  return visualisation;
};

/**
 * Désérialise les champs d'axes stockés en chaîne JSON (`axesgroup`, `axesxValue`, …).
 * `keyPrefix` : « axes » pour des axes déjà dépliés (`group`, `xValue`, …).
 */
export const deserialiseAxes = (visualisation: Record<string, unknown>, keyPrefix = ''): Record<string, unknown> => {
  const map = fromJS(visualisation);
  if (!isMap(map)) throw new TypeError('visualisation doit être un objet');
  return toJS(deserialiseAxesInternal(map, keyPrefix)) as Record<string, unknown>;
};
