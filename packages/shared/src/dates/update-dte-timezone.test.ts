// Portage de legacy/lib/helpers/tests/update$dteTimezone-test.js, plus quelques cas limites.
import { describe, expect, it } from 'vitest';
import { update$dteTimezone, update$dteTimezoneString } from './update-dte-timezone.js';

const query = (stored: string, timestamp: string) => ({
  $and: [
    {
      $or: [{ 'person._id': { $oid: '5942905ea563926886f4aeeb' } }],
      $comment: '{"criterionLabel":"A","criteriaPath":["person"]}',
    },
    {
      $or: [{ 'statement.verb.id': 'http://activitystrea.ms/schema/1.0/join' }],
      $comment: '{"criterionLabel":"B","criteriaPath":["statement","verb"]}',
    },
    {
      stored: { $timestamp: { $dte: stored } },
      $comment: '{"criterionLabel":"C","criteriaPath":["stored"]}',
    },
    {
      timestamp: { $timestamp: { $dte: timestamp } },
      $comment: '{"criterionLabel":"D","criteriaPath":["timestamp"]}',
    },
  ],
});

describe('update$dteTimezone', () => {
  it('change le décalage des $dte', () => {
    // America/La_Paz : -04:00, sans heure d'été
    const actual = update$dteTimezone(query('2019-02-19T00:00+13:00', '2016-11-04T00:00-07:30'), 'America/La_Paz');
    expect(actual).toEqual(query('2019-02-19T00:00-04:00', '2016-11-04T00:00-04:00'));
  });

  it('utilise tel quel un décalage de l\'interface', () => {
    const input = { $and: [{ timestamp: { $timestamp: { $dte: '2016-11-04T00:00-07:30' } }, $comment: '…' }] };
    expect(update$dteTimezone(input, '-05:00')).toEqual({ $and: [{ timestamp: { $timestamp: { $dte: '2016-11-04T00:00-05:00' } }, $comment: '…' }] });
  });

  it('tient compte de l\'heure d\'été', () => {
    // Europe/London passe à l'heure d'été le 25 mars 2018 à 01:00
    const actual = update$dteTimezone(query('2018-03-25T00:00', '2018-03-26T00:00'), 'Europe/London');
    expect(actual).toEqual(query('2018-03-25T00:00+00:00', '2018-03-26T00:00+01:00'));
  });

  it('garde l\'ordre des clés et ne touche pas aux $dte non textuels', () => {
    const actual = update$dteTimezone({ b: { $dte: 5 }, a: [{ $dte: '2026-07-01T12:30:45.123Z' }] }, 'Europe/Paris');
    expect(JSON.stringify(actual)).toBe('{"b":{"$dte":5},"a":[{"$dte":"2026-07-01T12:30+02:00"}]}');
  });

  it('produit « Invalid date » pour une date illisible, comme moment', () => {
    expect(update$dteTimezone({ $dte: '' }, 'Europe/Paris')).toEqual({ $dte: 'Invalid dateInvalid date' });
    expect(update$dteTimezone({ $dte: '' }, '+03:00')).toEqual({ $dte: 'Invalid date+03:00' });
  });

  it('lit un fuseau inconnu comme UTC', () => {
    expect(update$dteTimezone({ $dte: '2026-01-01T10:00+05:30' }, '+05:30')).toEqual({ $dte: '2026-01-01T10:00+00:00' });
  });
});

describe('update$dteTimezoneString', () => {
  it('réécrit une requête sérialisée et laisse passer les valeurs vides', () => {
    expect(update$dteTimezoneString('{"stored":{"$dte":"2019-02-19T00:00+13:00"}}', 'Asia/Tokyo')).toBe('{"stored":{"$dte":"2019-02-19T00:00+09:00"}}');
    expect(update$dteTimezoneString('', 'UTC')).toBe('');
    expect(update$dteTimezoneString(null, 'UTC')).toBeNull();
  });
});
