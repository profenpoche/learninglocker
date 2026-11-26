import { describe, expect, it } from 'vitest';
import { fromJS, getIn, immutableKeyOrder, sizeOf, toJS } from './immutable.js';

describe('immutableKeyOrder', () => {
  it('garde l\'ordre d\'insertion jusqu\'à 8 clés', () => {
    expect(immutableKeyOrder(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'])).toEqual(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']);
  });

  it('suit le hash des clés au-delà (HAMT d\'Immutable 3.8.2)', () => {
    // hash('a') = 97 = 0b00011_00001 : fragment bas 1 ; 'b' : 2 ; … ; 'i' : 9
    expect(immutableKeyOrder(['i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  });

  it('place la 9e clé en tête en cas de collision de hash (createNodes)', () => {
    // « Aa » et « BB » ont le même hash
    const keys = ['Aa', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'BB'];
    const order = immutableKeyOrder(keys);
    expect(order.indexOf('BB')).toBe(order.indexOf('Aa') - 1);
  });
});

describe('fromJS / getIn / toJS', () => {
  it('getIn renvoie la valeur par défaut sur une valeur nulle intermédiaire, mais une valeur nulle finale telle quelle', () => {
    const value = fromJS({ group: null, value: { optionKey: null }, list: ['a'] });
    expect(getIn(value, ['group', 'optionKey'], 'date')).toBe('date');
    expect(getIn(value, ['value', 'optionKey'], 'statements')).toBeNull();
    expect(getIn(value, ['list', '0'], 'x')).toBe('a');
    expect(getIn(value, ['list', 'optionKey'], 'x')).toBe('x');
  });

  it('laisse brut un objet qui a une clé « constructor »', () => {
    const raw = { constructor: 1, get: 'x', size: 0 };
    const value = fromJS({ a: raw });
    expect(getIn(value, ['a'], null)).toBe(raw);
    expect(() => getIn(value, ['a', 'b'], null)).toThrow(TypeError);
    expect(sizeOf(raw)).toBe(0);
  });

  it('toJS : une clé « __proto__ » disparaît de la sérialisation', () => {
    expect(JSON.stringify(toJS(fromJS(JSON.parse('{"__proto__":{"x":1},"b":2}'))))).toBe('{"b":2}');
  });
});
