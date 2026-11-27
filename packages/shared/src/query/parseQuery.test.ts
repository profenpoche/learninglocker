// Portage des tests legacy des helpers de requête (lib/helpers/tests/{convertStatementTimestamp,remove$out,
// filter$lookup,convert$personaIdent}-test.js), avec des faux à la place de la base.
// Les dates sans décalage sont lues en UTC (les tests d'origine tournaient dans un processus en UTC).
import { describe, expect, it } from 'vitest';
import {
  convert$dte,
  convert$oid,
  convert$personaIdent,
  convertStatementTimestamp,
  filter$lookup,
  parseQuery,
  parseQueryOrThrow,
  remove$out,
  type QueryDependencies,
} from './parseQuery.js';
import { ObjectIdRef, defaultObjectIdFactory, parseDateString } from './values.js';

const orgId = '561a679c0c5d017e4004714f';
const authInfo = { token: { tokenType: 'organisation', tokenId: orgId } };
const getScopeFilter: QueryDependencies['getScopeFilter'] = (request) =>
  Promise.resolve({ organisation: defaultObjectIdFactory.fromHex(String(getOrg(request.authInfo))) });
const getOrg = (info: unknown): unknown => (info as { token: { tokenId: string } }).token.tokenId;

describe('convertStatementTimestamp', () => {
  it('convertit un pipeline (tableau)', () => {
    const pipeline = [
      {
        $match: {
          'statement.timestamp': { $gte: { $dte: '2017-01-01' }, $lt: '2018-01-01T00:00:00' },
          $and: [
            { $comment: 'statement.stored.A', $or: [{ 'statement.stored': '-123' }] },
            { $comment: 'statement.stored.B', $or: [{ 'statement.stored': { $dte: '2018-01-01' } }] },
            { $comment: 'statement.timestamp.C', $or: [{ 'statement.timestamp': '2019-01-01' }] },
          ],
        },
      },
      { $sort: { 'statement.timestamp': -1 } },
      { $project: { 'statement.timestamp': 1 } },
    ];
    expect(convertStatementTimestamp(pipeline)).toEqual([
      {
        $match: {
          $and: [
            // '-123' : année 123, heure locale pour V8, donc minuit UTC dans le processus legacy
            { $comment: 'statement.stored.A', $or: [{ stored: new Date('0123-01-01T00:00:00Z') }] },
            { $comment: 'statement.stored.B', $or: [{ stored: { $dte: new Date('2018-01-01') } }] },
            { $comment: 'statement.timestamp.C', $or: [{ timestamp: new Date('2019-01-01') }] },
          ],
          timestamp: { $gte: { $dte: '2017-01-01' }, $lt: new Date('2018-01-01T00:00:00Z') },
        },
      },
      { $sort: { timestamp: -1 } },
      { $project: { 'statement.timestamp': 1 } },
    ]);
  });

  it('convertit un filtre (objet)', () => {
    expect(convertStatementTimestamp({ 'statement.timestamp': '2017-01-01' })).toEqual({ timestamp: new Date('2017-01-01') });
  });

  it('copie sans supprimer un chemin imbriqué { statement: { timestamp } } (comportement d’origine)', () => {
    expect(convertStatementTimestamp({ statement: { timestamp: '2017-01-01' } })).toEqual({ statement: { timestamp: '2017-01-01' }, timestamp: new Date('2017-01-01') });
  });
});

describe('remove$out', () => {
  it('retire les étapes $out d’un pipeline, mais pas une clé $out dans un objet', () => {
    expect(remove$out([{ $match: { a: { $out: 1 } } }, { $sort: { timestamp: -1 } }, { $out: 'authors' }])).toEqual([{ $match: { a: { $out: 1 } } }, { $sort: { timestamp: -1 } }]);
  });
});

describe('filter$lookup', () => {
  const lookup = { $lookup: { from: 'personas', as: 'personas', foreignField: '_id', localField: '_id' } };

  it('ajoute le filtre d’organisation à une collection autorisée sans pipeline', async () => {
    const result = await filter$lookup([{ $sort: { _id: -1 } }, structuredClone(lookup), { $project: { _id: 1 } }], authInfo, getScopeFilter);
    expect(result).toEqual([
      { $sort: { _id: -1 } },
      { $lookup: { ...lookup.$lookup, pipeline: [{ $match: { organisation: new ObjectIdRef(orgId) } }] } },
      { $project: { _id: 1 } },
    ]);
  });

  it('préfixe un pipeline existant et retire les collections non autorisées, à toute profondeur', async () => {
    const result = await filter$lookup([{ $lookup: { from: 'personas', pipeline: [{ $match: { foo: 'bar' } }, { $lookup: { from: 'users' } }, { $lookup: { from: 'statements', pipeline: [] } }] } }], authInfo, getScopeFilter);
    expect(result).toEqual([{
      $lookup: {
        from: 'personas',
        pipeline: [
          { $match: { organisation: new ObjectIdRef(orgId) } },
          { $match: { foo: 'bar' } },
          { $lookup: { from: 'statements', pipeline: [{ $match: { organisation: new ObjectIdRef(orgId) } }] } },
        ],
      },
    }]);
  });

  it('sans authInfo, ne fait que retirer les collections non autorisées', async () => {
    expect(await filter$lookup([{ $lookup: { from: 'users' } }, { $lookup: { from: 'personas' } }], undefined, getScopeFilter)).toEqual([{ $lookup: { from: 'personas' } }]);
  });
});

describe('convert$personaIdent', () => {
  const deps = (personaIds: unknown[]): QueryDependencies => ({
    getScopeFilter,
    getPersonaAttributes: (request) => Promise.resolve({ edges: request.organisation ? personaIds.map((personaId) => ({ node: { personaId } })) : [] }),
  });
  const query = { $personaIdent: { key: 'persona.import.hair', value: 'blond' } };

  it('crée une requête $in à partir des attributs', async () => {
    const id = new ObjectIdRef('5942905ea563926886f4aeeb');
    expect(await convert$personaIdent(query, { authInfo }, deps([id, null, undefined]))).toEqual({ $in: [id] });
  });

  it('sans organisation, $in est vide', async () => {
    expect(await convert$personaIdent(query, undefined, deps([new ObjectIdRef('5942905ea563926886f4aeeb')]))).toEqual({ $in: [] });
  });
});

describe('convert$oid / convert$dte', () => {
  it('convertit les ObjectId valides et laisse les autres', () => {
    expect(convert$oid({ a: { $oid: '6B083FE419B92523F89D6725' }, b: { $oid: 'invalide' }, c: { $oid: 'abcdefghijkl' } })).toEqual({
      a: new ObjectIdRef('6b083fe419b92523f89d6725'),
      b: 'invalide',
      c: new ObjectIdRef('6162636465666768696a6b6c'),
    });
  });

  it('génère un ObjectId pour null ou un nombre (horodatage)', () => {
    const generated = convert$oid({ $oid: 123 }) as ObjectIdRef;
    expect(generated.hex.slice(0, 8)).toBe('0000007b');
    expect(convert$oid({ $oid: null })).toBeInstanceOf(ObjectIdRef);
  });

  it('lit les dates sans décalage en UTC', () => {
    expect(convert$dte({ a: { $dte: '2026-03-29T02:30' } })).toEqual({ a: new Date('2026-03-29T02:30:00Z') });
    expect(parseDateString('Jan 1 2026 10:00')).toEqual(new Date('2026-01-01T10:00:00Z'));
    expect(parseDateString('Jan 1 2026 10:00 GMT+0200')).toEqual(new Date('2026-01-01T08:00:00Z'));
  });
});

describe('parseQuery', () => {
  const deps: QueryDependencies = { getScopeFilter, getPersonaAttributes: () => Promise.resolve({ edges: [] }) };

  it('résout avec l’erreur au lieu de rejeter (comportement d’origine)', async () => {
    expect(await parseQuery('{oups', { authInfo }, deps)).toBeInstanceOf(SyntaxError);
    await expect(parseQueryOrThrow('{oups', { authInfo }, deps)).rejects.toThrow(SyntaxError);
  });

  it('enchaîne $oid, $dte, timestamp, $out, $lookup', async () => {
    const result = await parseQuery(JSON.stringify([{ $match: { 'statement.stored': { $gte: { $dte: '2026-01-01T00:00Z' } }, lrs_id: { $oid: orgId } } }, { $out: 'x' }]), { authInfo }, deps);
    expect(result).toEqual([{ $match: { lrs_id: new ObjectIdRef(orgId), stored: { $gte: new Date('2026-01-01T00:00:00Z') } } }]);
  });
});
