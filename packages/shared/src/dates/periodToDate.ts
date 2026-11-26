// Début de la période d'aperçu d'une visualisation (previewPeriod), en UTC.
// Code d'origine : legacy/ui/src/utils/dates.js (periodToDate), constantes legacy/ui/src/utils/constants.js.

import moment from 'moment-timezone';
import { applyTimezone, toTimezone } from './timezones.js';

export const TODAY = 'TODAY';
export const LAST_24_HOURS = 'LAST_24_HOURS';
export const LAST_7_DAYS = 'LAST_7_DAYS';
export const LAST_30_DAYS = 'LAST_30_DAYS';
export const LAST_2_MONTHS = 'LAST_2_MONTHS';
export const LAST_6_MONTHS = 'LAST_6_MONTHS';
export const LAST_1_YEAR = 'LAST_1_YEAR';
export const LAST_2_YEARS = 'LAST_2_YEARS';

/** Périodes d'aperçu connues, dans l'ordre de ui/src/utils/constants.js. */
export const PREVIEW_PERIODS = [TODAY, LAST_7_DAYS, LAST_30_DAYS, LAST_2_MONTHS, LAST_6_MONTHS, LAST_24_HOURS, LAST_1_YEAR, LAST_2_YEARS] as const;

/**
 * Date de début de `period` à partir de `currentMoment`, en UTC.
 *
 * - `benchmark` multiplie la durée (2 = début de la période précédente, pour la comparaison) ;
 * - TODAY = minuit du jour courant dans `timezone`, **sans** multiplicateur (bug d'origine : la
 *   fenêtre de comparaison de TODAY est vide) ;
 * - période inconnue ou absente = LAST_7_DAYS ;
 * - `timezone` : nom IANA ou décalage de l'interface (« +03:00 ») ; un fuseau inconnu vaut UTC.
 *
 * @param currentMoment moment, Date, nombre (ms) ou chaîne ISO (lue en UTC si elle n'a pas de
 *   décalage, quel que soit le fuseau du processus) ; il n'est pas modifié.
 */
export const periodToDate = (period: unknown, timezone: unknown, currentMoment: moment.MomentInput, benchmark = 1): moment.Moment => {
  const cloned = moment.isMoment(currentMoment) ? moment(currentMoment).utc() : moment.utc(currentMoment);

  switch (period) {
    case TODAY: return applyTimezone(cloned, toTimezone(timezone)).startOf('day').utc();
    case LAST_24_HOURS: return cloned.subtract(24 * benchmark, 'hours');
    case LAST_7_DAYS: return cloned.subtract(7 * benchmark, 'days');
    case LAST_30_DAYS: return cloned.subtract(30 * benchmark, 'days');
    case LAST_2_MONTHS: return cloned.subtract(2 * benchmark, 'months');
    case LAST_6_MONTHS: return cloned.subtract(6 * benchmark, 'months');
    case LAST_1_YEAR: return cloned.subtract(1 * benchmark, 'years');
    case LAST_2_YEARS: return cloned.subtract(2 * benchmark, 'years');
    default: return cloned.subtract(7 * benchmark, 'days');
  }
};
