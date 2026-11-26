// Fuseaux « décalage fixe » de l'interface et application d'un fuseau à un moment, avec la sémantique
// exacte de moment-timezone (fn.tz) utilisée par le code d'origine.
// Code d'origine : legacy/lib/constants/timezones.js (UTC_BASED_ZONE_TZ, UTC_BASED_ZONE_LABELS,
// toTimezone) ; node_modules/moment-timezone (fn.tz).

import moment from 'moment-timezone';

/** Décalage affiché dans l'interface → fuseau IANA « Etc/GMT±N » (signe inversé, convention POSIX). */
const UTC_BASED_ZONE_TZ: Readonly<Record<string, string>> = {
  '-12:00': 'Etc/GMT+12',
  '-11:00': 'Etc/GMT+11',
  '-10:00': 'Etc/GMT+10',
  '-09:00': 'Etc/GMT+9',
  '-08:00': 'Etc/GMT+8',
  '-07:00': 'Etc/GMT+7',
  '-06:00': 'Etc/GMT+6',
  '-05:00': 'Etc/GMT+5',
  '-04:00': 'Etc/GMT+4',
  '-03:00': 'Etc/GMT+3',
  '-02:00': 'Etc/GMT+2',
  '-01:00': 'Etc/GMT+1',
  UTC: 'UTC',
  '+01:00': 'Etc/GMT-1',
  '+02:00': 'Etc/GMT-2',
  '+03:00': 'Etc/GMT-3',
  '+04:00': 'Etc/GMT-4',
  '+05:00': 'Etc/GMT-5',
  '+06:00': 'Etc/GMT-6',
  '+07:00': 'Etc/GMT-7',
  '+08:00': 'Etc/GMT-8',
  '+09:00': 'Etc/GMT-9',
  '+10:00': 'Etc/GMT-10',
  '+11:00': 'Etc/GMT-11',
  '+12:00': 'Etc/GMT-12',
  '+13:00': 'Etc/GMT-13',
  '+14:00': 'Etc/GMT-14',
};

/** Clés de UTC_BASED_ZONE_LABELS_MAP : les décalages entiers proposés par l'interface, plus « UTC ». */
export const isUtcBasedZoneLabel = (timezone: unknown): boolean => typeof timezone === 'string' && Object.hasOwn(UTC_BASED_ZONE_TZ, timezone);

/** toTimezone : décalage de l'interface → nom IANA ; toute autre valeur est renvoyée telle quelle. */
export const toTimezone = (timezone: unknown): unknown => (typeof timezone === 'string' && Object.hasOwn(UTC_BASED_ZONE_TZ, timezone) ? UTC_BASED_ZONE_TZ[timezone] : timezone);

/**
 * Noms connus des données tz du front d'origine (moment-timezone 0.5.27, tzdata 2019c) et retirés depuis.
 * Ils restent sélectionnables dans d'anciennes configurations : on les ramène à leur cible d'alors.
 */
const REMOVED_ZONE_LINKS: Readonly<Record<string, string>> = {
  'us/pacific-new': 'America/Los_Angeles',
};

const findZone = (name: string): moment.MomentZone | null => {
  const zone = moment.tz.zone(name);
  if (zone) return zone;
  const link = REMOVED_ZONE_LINKS[name.toLowerCase()];
  return link === undefined ? null : moment.tz.zone(link);
};

/**
 * `m.tz(name)` de moment-timezone, sans son effet de bord console :
 * - nom « faux » ('' , null…) : la méthode devient un accesseur et renvoie undefined ; l'appel suivant
 *   de l'original (`.startOf`, `.format`) lève une TypeError, reproduite ici ;
 * - nom non chaîne : Error ;
 * - fuseau inconnu (ex. « +05:30 ») : le moment reste dans son mode courant (UTC ici), l'original
 *   journalise seulement une erreur.
 * Modifie et renvoie `m`.
 */
export const applyTimezone = (m: moment.Moment, name: unknown): moment.Moment => {
  if (!name) {
    throw new TypeError(`Fuseau vide (${String(name)}) : moment.tz() ne renvoie pas de moment`);
  }
  if (typeof name !== 'string') {
    throw new Error(`Time zone name must be a string, got ${JSON.stringify(name)} [${typeof name}]`);
  }
  const zone = findZone(name);
  return zone ? m.tz(zone.name) : m;
};
