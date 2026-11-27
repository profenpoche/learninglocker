import { describe, expect, it } from 'vitest';
import { fromCursor, pickForCursor, toCursor } from './connection.js';
import { ErmError, mergeConditions, mergeSelect, prepareQuery } from './erm.js';

describe('prepareQuery (express-restify-mongoose 3.2.1)', () => {
  it('liste blanche, JSON, entiers et raccourcis du paramètre query', () => {
    expect(prepareQuery({
      query: '{"title":"~^ab","n":">=3","m":"<2","x":"!=y","tags":["a","b"],"$or":[{"a":1}],"coordinates":[1,2],"pt":[1.5,2]}',
      sort: '{"_id":-1}', select: 'title,-description', skip: '5', limit: 'abc', distinct: 'type', autre: 'ignoré',
    })).toEqual({
      query: { title: /^ab/i, n: { $gte: '3' }, m: { $lt: '2' }, x: { $ne: 'y' }, tags: { $in: ['a', 'b'] }, $or: [{ a: 1 }], coordinates: [1, 2], pt: [1.5, 2] },
      sort: { _id: -1 }, select: { title: 1, description: 0 }, skip: 5, limit: NaN, distinct: 'type',
    });
  });
  it('JSON invalide dans query : ErmError 400 invalid_json', () => {
    expect(() => prepareQuery({ query: '{oups' })).toThrow(ErmError);
    try { prepareQuery({ query: '{oups' }); } catch (error) {
      expect(error).toMatchObject({ message: '%s must be a valid JSON string', statusCode: 400, description: 'invalid_json' });
    }
  });
  it('populate en chaîne : chemins et sous-sélections tirées de select', () => {
    expect(prepareQuery({ populate: 'owner', select: '{"title":1,"owner.email":1}' })).toEqual({
      populate: [{ path: 'owner', select: 'email' }],
      select: { title: 1, owner: 1 },
    });
  });
});

describe('mergeConditions (Mongoose 5.8, avec correctif D7)', () => {
  it('ajoute les clés du client sans toucher au filtre de droits', () => {
    expect(mergeConditions({ $and: [{ organisation: 1 }] }, { title: 'a' })).toEqual({ $and: [{ organisation: 1 }], title: 'a' });
  });
  it('un `$and` du client s’ajoute au filtre de droits au lieu de le remplacer', () => {
    expect(mergeConditions({ $and: [{ organisation: 1 }] }, { $and: [{}] })).toEqual({ $and: [{ organisation: 1 }, {}] });
  });
  it('un `$or` déjà présent (filtre public) est conservé', () => {
    expect(mergeConditions({ $or: [{ isPublic: true }] }, { $or: [{ _id: 2 }] })).toEqual({ $and: [{ $or: [{ isPublic: true }] }, { $or: [{ _id: 2 }] }] });
  });
  it('fusion profonde des objets, écrasement des autres valeurs', () => {
    expect(mergeConditions({ a: { $gt: 1 }, b: 1 }, { a: { $lt: 5 }, b: 2 })).toEqual({ a: { $gt: 1, $lt: 5 }, b: 2 });
  });
});

describe('mergeSelect (Query.prototype.select de Mongoose 5.8)', () => {
  it('cumule les champs : la sélection du client s’ajoute à celle des droits', () => {
    expect(mergeSelect(mergeSelect({}, { _id: 1, email: 1 }), { password: 1 })).toEqual({ _id: 1, email: 1, password: 1 });
    expect(mergeSelect({}, 'a -b')).toEqual({ a: 1, b: 0 });
  });
});

describe('curseurs', () => {
  it('base64 de JSON, lecture tolérante', () => {
    expect(toCursor({ _id: '6b08471b4f911e2078997f5a' })).toBe('eyJfaWQiOiI2YjA4NDcxYjRmOTExZTIwNzg5OTdmNWEifQ==');
    expect(toCursor({})).toBe('e30=');
    expect(fromCursor('e30=')).toEqual({});
    expect(fromCursor('curseur-invalide')).toBeNull();
    expect(fromCursor(undefined)).toBeNull();
  });
  it('_.pick des clés de tri, chemins pointés compris', () => {
    const doc = { _id: 'x', statement: { id: 's', verb: {} }, timestamp: new Date(0) };
    expect(pickForCursor(doc, { 'statement.id': 1, timestamp: -1, absent: 1 })).toEqual({ statement: { id: 's' }, timestamp: new Date(0) });
  });
});
