// Portage de legacy/ui/src/utils/queries/has$dte.spec.js, plus des exemples des autres utilitaires.
import { describe, expect, it } from 'vitest';
import { addTokenToQuery, getCriteria, has$dte, queryToStringList } from './queries.js';

const nested = (leaf: Record<string, unknown>) => ({
  a: [
    { a1: [{ a11: { a11a: 'x' } }, { a12: ['x', { a122a: 'x' }] }], a2: { a2a: 'x', a2b: 'x' } },
    { ab: { aba: [], abb: leaf } },
  ],
});

describe('has$dte', () => {
  it('vrai si une clé $dte existe à une profondeur quelconque', () => {
    expect(has$dte(nested({ $dte: 'x' }))).toBe(true);
  });

  it('faux sinon', () => {
    expect(has$dte(nested({ sdte: 'x' }))).toBe(false);
  });
});

const comment = (label: string, ...path: string[]) => JSON.stringify({ criterionLabel: label, criteriaPath: path });

describe('critères', () => {
  const query = {
    $and: [
      { $comment: comment('A', 'statement', 'verb'), 'statement.verb.id': { $in: ['v1'] } },
      { $comment: 'statement.actor', $or: [{ 'statement.actor.mbox': 'mailto:a@b.c' }] },
    ],
  };

  it('lit les critères et convertit un ancien $comment', () => {
    expect(getCriteria(query).map(({ key }) => key)).toEqual([
      { criterionLabel: 'A', criteriaPath: ['statement', 'verb'] },
      { criterionLabel: 'B', criteriaPath: ['statement', 'actor'] },
    ]);
    expect(queryToStringList(query)).toEqual(['statement.verb (1 item)', 'statement.actor (1 item)']);
  });

  it('ajoute un jeton au $in existant (même s’il y est déjà : comportement d’origine)', () => {
    expect(addTokenToQuery(query, ['statement', 'verb'], { 'statement.verb.id': 'v1' })).toEqual({
      $and: [
        { $comment: comment('A', 'statement', 'verb'), 'statement.verb.id': { $in: ['v1', 'v1'] } },
        { $comment: comment('B', 'statement', 'actor'), $or: [{ 'statement.actor.mbox': 'mailto:a@b.c' }] },
      ],
    });
  });

  it('une valeur scalaire remet les critères à zéro (comportement d’origine)', () => {
    expect(getCriteria({ $and: [{ $comment: comment('A', 'x'), x: 1 }], autre: 5 })).toEqual([]);
  });
});
