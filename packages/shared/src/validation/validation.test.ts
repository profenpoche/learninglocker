import { describe, expect, it } from 'vitest';
import { assertValidIfi, messageFromWarning, validateIfi, RulrWarnings, hasIdentifierValueErrors } from './ifi.js';
import { DEFAULT_PASSWORD_SETTINGS, nextPasswordHistory, validatePassword, validatePasswordUtil } from './password.js';

describe('validatePasswordUtil', () => {
  it('applique les règles par défaut, messages d’origine', () => {
    expect(validatePasswordUtil('abc', DEFAULT_PASSWORD_SETTINGS)).toEqual({
      success: false,
      messages: ['The password must be at least 8 characters long', 'The password must include at least one number'],
    });
    expect(validatePasswordUtil('', DEFAULT_PASSWORD_SETTINGS)).toEqual({ success: true, messages: [] });
  });

  it('une expression personnalisée remplace les règles lettre/chiffre', () => {
    const settings = { ...DEFAULT_PASSWORD_SETTINGS, PASSWORD_USE_CUSTOM_REGEX: true, PASSWORD_CUSTOM_REGEX: '^[A-Z]', PASSWORD_CUSTOM_MESSAGE: 'Majuscule' };
    expect(validatePasswordUtil('abcdefgh', settings)).toEqual({ success: false, messages: ['Majuscule'] });
  });
});

describe('validatePassword', () => {
  const comparePassword = (value: string, hash: unknown) => Promise.resolve(hash === `h:${value}`);

  it('refuse un des N derniers mots de passe', async () => {
    const history = [{ date: new Date('2026-01-01'), hash: 'h:Ancien1234' }];
    await expect(validatePassword({ value: 'Ancien1234', settings: DEFAULT_PASSWORD_SETTINGS, history, comparePassword }))
      .rejects.toThrow('This is one of your last 3 passwords - please use a different password.');
    await expect(validatePassword({ value: 'Nouveau1234', settings: DEFAULT_PASSWORD_SETTINGS, history, comparePassword })).resolves.toBe(true);
  });
});

describe('nextPasswordHistory', () => {
  it('garde les N plus récentes entrées complètes', () => {
    const history = [{ date: 3, hash: 'c' }, { date: 1, hash: 'a' }, { hash: 'sans date' }, { date: 2, hash: 'b' }];
    expect(nextPasswordHistory(history, { date: 4, hash: 'd' }, 3)).toEqual([{ date: 2, hash: 'b' }, { date: 3, hash: 'c' }, { date: 4, hash: 'd' }]);
  });
});

describe('IFI', () => {
  it('messages de l’API', () => {
    const [warning] = validateIfi({ key: 'mbox', value: 'pas-un-mailto' }, ['body', 'ifi']);
    expect(messageFromWarning(warning)).toBe('Invalid Mailto in body.ifi.value');
    const missing = validateIfi({ key: 'account', value: { name: 'x' } }, ['ifi']);
    expect(missing.map(messageFromWarning)).toEqual(['Missing required data in ifi.value.homePage']);
  });

  it('assertValidIfi lève RulrWarnings (objet non Error, comme rulr)', () => {
    expect(() => assertValidIfi({ key: 'inconnu' }, ['ifi'])).toThrow(RulrWarnings);
    expect(hasIdentifierValueErrors('account', { homePage: 'https://x', name: 'n' })).toBe(false);
  });
});
