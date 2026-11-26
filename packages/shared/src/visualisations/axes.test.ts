// Portage de legacy/lib/helpers/tests/visualisation-test.js (unflattenAxes, deserialiseAxes) et de
// legacy/ui/src/utils/schemas.spec.js (reviver du schéma visualisation).
import { describe, expect, it } from 'vitest';
import { deserialiseAxes, unflattenAxes } from './axes.js';
import { VISUALISE_AXES_PREFIX } from './constants.js';
import { immutableKeyOrder } from './immutable.js';
import { reviveVisualisation } from './revive.js';

describe('unflattenAxes', () => {
  it('garde les clés « axes… » et retire le préfixe', () => {
    const out = unflattenAxes({ axesyLabel: 'Y-axes', axesyValue: '{"test": "testValue"}', otherValue: 'otherValue', axes: '{}' });
    expect(out).toEqual({ yLabel: 'Y-axes', yValue: '{"test": "testValue"}' });
  });
});

describe('deserialiseAxes', () => {
  const serialised = {
    group: '{"test1": "test2"}',
    xValue: '{"test3": "test4"}',
    yValue: '{"test5": "test6"}',
    value: '{"test7": "test8"}',
    yQuery: '{"test9": "test10"}',
    xQuery: '{"test11": "test12"}',
    query: '{"test13": "test14"}',
  };

  it('désérialise les champs d\'axes', () => {
    const input = { axesyLabel: 'Y-axes', other: '{"test15": "test16"}', ...Object.fromEntries(Object.entries(serialised).map(([k, v]) => [`axes${k}`, v])) };
    const out = deserialiseAxes(input);
    expect(out.axesyLabel).toBe('Y-axes');
    expect(out.axesgroup).toEqual({ test1: 'test2' });
    expect(out.axesxValue).toEqual({ test3: 'test4' });
    expect(out.axesyValue).toEqual({ test5: 'test6' });
    expect(out.axesvalue).toEqual({ test7: 'test8' });
    expect(out.axesyQuery).toEqual({ test9: 'test10' });
    expect(out.axesxQuery).toEqual({ test11: 'test12' });
    expect(out.axesquery).toEqual({ test13: 'test14' });
    expect(out.other).toBe('{"test15": "test16"}');
    // Map.merge : les clés gardent leur position (ordre Immutable : plus de 8 clés, donc ordre du hash)
    expect(Object.keys(out)).toEqual(immutableKeyOrder(Object.keys(input)));
  });

  it('désérialise des axes dépliés avec le préfixe', () => {
    const out = deserialiseAxes({ yLabel: 'Y-axes', other: '{"test15": "test16"}', ...serialised }, VISUALISE_AXES_PREFIX);
    expect(out.yLabel).toBe('Y-axes');
    expect(out.group).toEqual({ test1: 'test2' });
    expect(out.xQuery).toEqual({ test11: 'test12' });
    expect(out.query).toEqual({ test13: 'test14' });
    expect(out.other).toBe('{"test15": "test16"}');
  });

  it('lève une SyntaxError sur un JSON invalide', () => {
    expect(() => deserialiseAxes({ axesgroup: '{oups' })).toThrow(SyntaxError);
  });
});

describe('reviveVisualisation', () => {
  it('ne parse pas axesxOperator', () => {
    expect(reviveVisualisation({ axesxOperator: 'testOperator' }).axesxOperator).toBe('testOperator');
  });

  it('parse axesxValue', () => {
    expect(reviveVisualisation({ axesxValue: JSON.stringify({ value: 99 }) }).axesxValue).toEqual({ value: 99 });
  });

  it('parse les séries, le champ axes et remplace une série illisible par {}', () => {
    const model = reviveVisualisation({
      type: 'PIE',
      filters: ['{"label":"A","$match":{"x":1}}', 'pas du json', '5'],
      axes: '{"group":{"optionKey":"verb"}}',
      axesgroup: 'null',
    });
    expect(model).toEqual({
      type: 'PIE',
      filters: [{ label: 'A', $match: { x: 1 } }, {}, 5],
      axes: { group: { optionKey: 'verb' } },
      axesgroup: null,
    });
  });
});
