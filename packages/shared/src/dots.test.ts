import { describe, expect, it } from 'vitest';
import { decodeDot, encodeDot, mapDot } from './dots.js';

describe('encodeDot / decodeDot', () => {
  it('encode chaque point', () => {
    expect(encodeDot('https://profenpoche.test/xapi/extensions/appareil')).toBe('https://profenpoche&46;test/xapi/extensions/appareil');
    expect(encodeDot('a.b.c')).toBe('a&46;b&46;c');
    expect(encodeDot('sans-point')).toBe('sans-point');
  });

  it('décode chaque « &46; »', () => {
    expect(decodeDot('a&46;b&46;c')).toBe('a.b.c');
    expect(decodeDot('&46;&46;')).toBe('..');
  });

  it('est réversible', () => {
    const key = 'http://id.tincanapi.com/extension/duration.seconds';
    expect(decodeDot(encodeDot(key))).toBe(key);
  });
});

describe('mapDot', () => {
  it('décode les clés récursivement, sans toucher aux valeurs', () => {
    const input = {
      'a&46;b': { 'c&46;d': 'valeur.avec&46;point' },
      liste: [{ 'e&46;f': 1 }, 'x&46;y'],
    };
    expect(mapDot(input)).toEqual({
      'a.b': { 'c.d': 'valeur.avec&46;point' },
      liste: [{ 'e.f': 1 }, 'x&46;y'],
    });
  });

  it('encode avec encodeDot (métadonnées de statement)', () => {
    expect(mapDot({ 'https://profenpoche.test/meta.revue': { 'a.b': true } }, encodeDot)).toEqual({
      'https://profenpoche&46;test/meta&46;revue': { 'a&46;b': true },
    });
  });

  it('laisse intacts les objets qui ne sont pas des objets simples', () => {
    class Id { constructor(readonly hex: string) {} }
    const id = new Id('6b0838efcab0ac1e660da751');
    const date = new Date('2026-11-26T00:00:00Z');
    const out = mapDot({ 'k&46;1': id, 'k&46;2': date });
    expect(out['k.1' as keyof typeof out]).toBe(id);
    expect(out['k.2' as keyof typeof out]).toBe(date);
  });

  it('renvoie les valeurs scalaires et null telles quelles', () => {
    expect(mapDot('a&46;b')).toBe('a&46;b');
    expect(mapDot(null)).toBeNull();
    expect(mapDot(42)).toBe(42);
  });

  it('accepte les objets sans prototype', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['x&46;y'] = 1;
    expect(mapDot(bare)).toEqual({ 'x.y': 1 });
  });
});
