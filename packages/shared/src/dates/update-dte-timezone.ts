// Réécrit chaque `{"$dte": "…"}` d'une requête avec le décalage du fuseau, en gardant la date et l'heure
// « murales » (minutes comprises, secondes et décalage d'origine ignorés).
// Code d'origine : legacy/lib/helpers/update$dteTimezone.js.

import moment from 'moment-timezone';
import { fromJS, isList, isMap, mapFromEntries, toJS } from '../visualisations/immutable.js';
import { applyTimezone, isUtcBasedZoneLabel } from './timezones.js';

const INVALID_DATE = 'Invalid date';

/**
 * Décalage « Z » (ex. « -08:00 ») de `timezone` à l'instant `yyyymmddhhmm`.
 *
 * L'original lit `yyyymmddhhmm` dans le fuseau **local du processus** (`moment(yyyymmddhhmm)`) ; le
 * conteneur legacy et le serveur tournent en UTC : on lit en UTC, indépendamment de l'environnement.
 */
const toZ = (yyyymmddhhmm: string, timezone: unknown): string => {
  if (isUtcBasedZoneLabel(timezone) && timezone !== 'UTC') {
    return timezone as string;
  }
  const m = yyyymmddhhmm === INVALID_DATE ? moment.invalid() : moment.utc(yyyymmddhhmm);
  return applyTimezone(m, timezone).format('Z');
};

const updateDte = (value: string, timezone: unknown): string => {
  // Ignore le décalage présent dans la valeur. L'original appelle moment.parseZone(value), qui lit
  // d'abord une valeur SANS décalage dans le fuseau local du processus : une heure absente de ce
  // fuseau (passage à l'heure d'été) y est décalée d'une heure. On lit en UTC, comme le conteneur
  // legacy et le serveur ; parseZone() garde ensuite le décalage écrit dans la valeur, s'il y en a un.
  const yyyymmddhhmm = moment.utc(value).parseZone().format('YYYY-MM-DDTHH:mm');
  return `${yyyymmddhhmm}${toZ(yyyymmddhhmm, timezone)}`;
};

/**
 * Version interne : `query` est une valeur déjà « fromJS » (Map émulées, voir immutable.ts).
 * Les Map sont reconstruites (mapEntries), les List parcourues, le reste renvoyé tel quel.
 */
export const update$dteTimezoneInternal = (query: unknown, timezone: unknown): unknown => {
  if (isMap(query)) {
    return mapFromEntries(Object.keys(query).map((key) => {
      const value = query[key];
      if (key === '$dte' && typeof value === 'string') {
        return [key, updateDte(value, timezone)];
      }
      return [key, update$dteTimezoneInternal(value, timezone)];
    }));
  }
  if (isList(query)) {
    return query.map((value: unknown) => update$dteTimezoneInternal(value, timezone));
  }
  return query;
};

/**
 * Change le décalage de chaque `$dte` de `query` (valeur JSON) pour celui de `timezone`
 * (nom IANA ou décalage de l'interface comme « +03:00 », utilisé tel quel).
 *
 * @example update$dteTimezone({ $dte: '2019-12-31T00:00-11:00' }, 'Asia/Tokyo') // { $dte: '2019-12-31T00:00+09:00' }
 */
export const update$dteTimezone = <T>(query: T, timezone: string): T => toJS(update$dteTimezoneInternal(fromJS(query), timezone)) as T;

/**
 * Variante sur une requête sérialisée (chaîne JSON) ; renvoie la valeur telle quelle si elle est vide.
 * Code d'origine : update$dteTimezoneString.
 */
export const update$dteTimezoneString = <T extends string | null | undefined>(queryString: T, timezone: string): T => {
  if (!queryString) return queryString;
  const updated = update$dteTimezoneInternal(fromJS(JSON.parse(queryString)), timezone);
  // L'original appelle updated.toJS() : une valeur scalaire ou un objet brut lève une TypeError.
  if (!isMap(updated) && !isList(updated)) throw new TypeError('updated.toJS is not a function');
  return JSON.stringify(toJS(updated)) as T;
};
