import { describe, expect, it } from 'vitest';
import { errorToJson, parseJsonLegacy } from './legacy-json.js';

const message = (text: unknown) => {
  try {
    parseJsonLegacy(text);
  } catch (error) {
    return (error as Error).message;
  }
  return 'ok';
};

describe('parseJsonLegacy (messages de Node 10)', () => {
  it('analyse le JSON valide comme JSON.parse', () => {
    expect(parseJsonLegacy('{"a":[1,2,{"b":null}]}')).toEqual({ a: [1, 2, { b: null }] });
  });
  it.each([
    ['{oups', 'Unexpected token o in JSON at position 1'],
    ['[{oups', 'Unexpected token o in JSON at position 2'],
    ['', 'Unexpected end of JSON input'],
    ['{"a":', 'Unexpected end of JSON input'],
    ['{"a" 1}', 'Unexpected number in JSON at position 5'],
    ['{"a":1 "b":2}', 'Unexpected string in JSON at position 7'],
    ['[1,]', 'Unexpected token ] in JSON at position 3'],
    ['tru', 'Unexpected end of JSON input'],
    ['truc', 'Unexpected token c in JSON at position 3'],
    ['{} x', 'Unexpected token x in JSON at position 3'],
    [{}, 'Unexpected token o in JSON at position 1'],
  ])('%j → %s', (text, expected) => {
    expect(message(text)).toBe(expected);
  });
});

describe('errorToJson', () => {
  it('garde les propriétés propres de l’erreur, sans la pile', () => {
    const error = Object.assign(new Error('Not Found'), { statusCode: 404, reason: new Error('cause') });
    expect(errorToJson(error)).toEqual({ message: 'Not Found', statusCode: 404, reason: { message: 'cause' } });
  });
});
