// Portage de legacy/ui/src/utils/dates.spec.js (les dates y étaient lues dans le fuseau local, UTC
// en CI : on les lit explicitement en UTC), plus les autres périodes.
import moment from 'moment-timezone';
import { describe, expect, it } from 'vitest';
import { LAST_24_HOURS, LAST_2_MONTHS, LAST_7_DAYS, TODAY, periodToDate } from './periodToDate.js';

describe('periodToDate', () => {
  it('TODAY : minuit local du jour, en UTC (1)', () => {
    // 2019-02-27 01:06:00 à Tokyo
    const currentMoment = moment.utc('2019-02-26 16:06:00');
    expect(periodToDate(TODAY, 'Asia/Tokyo', currentMoment).toISOString()).toBe(moment.utc('2019-02-26 15:00:00').toISOString());
  });

  it('TODAY : minuit local du jour, en UTC (2)', () => {
    // 2019-02-26 23:59:00 à Tokyo
    const currentMoment = moment.utc('2019-02-26 14:59:00');
    expect(periodToDate(TODAY, 'Asia/Tokyo', currentMoment).toISOString()).toBe(moment.utc('2019-02-25 15:00:00').toISOString());
  });

  it('LAST_24_HOURS : 24 heures avant, en UTC', () => {
    const currentMoment = moment.utc('2019-02-26 16:06:00');
    expect(periodToDate(LAST_24_HOURS, 'Asia/Tokyo', currentMoment).toISOString()).toBe(moment.utc('2019-02-25 16:06:00').toISOString());
  });

  it('TODAY ignore le multiplicateur de comparaison (bug d\'origine)', () => {
    const now = '2026-03-29T10:00:00Z';
    expect(periodToDate(TODAY, 'Europe/Paris', now, 2).toISOString()).toBe('2026-03-28T23:00:00.000Z');
  });

  it('TODAY : un décalage de l\'interface devient un fuseau Etc/GMT, un fuseau inconnu vaut UTC', () => {
    const now = '2026-06-14T20:00:00Z';
    expect(periodToDate(TODAY, '+05:00', now).toISOString()).toBe('2026-06-14T19:00:00.000Z');
    expect(periodToDate(TODAY, '+05:30', now).toISOString()).toBe('2026-06-14T00:00:00.000Z');
    expect(periodToDate(TODAY, 'US/Pacific-New', now).toISOString()).toBe('2026-06-14T07:00:00.000Z');
  });

  it('soustrait en UTC, mois calendaires compris, et vaut LAST_7_DAYS par défaut', () => {
    const now = '2026-03-31T12:00:00Z';
    expect(periodToDate(LAST_2_MONTHS, 'Europe/Paris', now).toISOString()).toBe('2026-01-31T12:00:00.000Z');
    expect(periodToDate(LAST_2_MONTHS, 'Europe/Paris', now, 2).toISOString()).toBe('2025-11-30T12:00:00.000Z');
    expect(periodToDate(undefined, 'UTC', now).toISOString()).toBe(periodToDate(LAST_7_DAYS, 'UTC', now).toISOString());
  });

  it('lève une erreur pour un fuseau vide ou non textuel avec TODAY, comme moment-timezone', () => {
    expect(() => periodToDate(TODAY, '', '2026-01-01T00:00:00Z')).toThrow(TypeError);
    expect(() => periodToDate(TODAY, 5, '2026-01-01T00:00:00Z')).toThrow('Time zone name must be a string');
  });
});
