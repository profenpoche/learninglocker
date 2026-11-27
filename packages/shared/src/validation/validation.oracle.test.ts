// Test différentiel de la validation (mots de passe, IFI) contre le vrai code legacy
// (fixture validation.json.gz, tools/oracle/libs.mjs). Faux bcrypt identique à celui du serveur
// d'oracle : compare(valeur, empreinte) ⇔ empreinte === 'h:' + valeur.
import { describe, expect, it } from 'vitest';
import { compareCases, loadOracle, tag } from '../testing/oracle.js';
import {
  RulrRequiredWarning,
  RulrRestrictedKeysWarning,
  RulrTypeWarning,
  RulrWarning,
  RulrWarnings,
  XapiTypeWarning,
  assertValidIfi,
  assertValidIfis,
  hasIdentifierValueErrors,
  messageFromWarning,
  validateIfi,
} from './ifi.js';
import { validatePassword, validatePasswordUtil, type PasswordHistoryItem, type PasswordSettings } from './password.js';

type Input = Record<string, unknown> & { route: string };

const oracle = loadOracle<Input>('validation');

const kind = (w: unknown): string => {
  if (w instanceof XapiTypeWarning) return 'XapiTypeWarning';
  if (w instanceof RulrWarnings) return 'Warnings';
  if (w instanceof RulrTypeWarning) return 'TypeWarning';
  if (w instanceof RulrRequiredWarning) return 'RequiredWarning';
  if (w instanceof RulrRestrictedKeysWarning) return 'RestrictedKeysWarning';
  if (w instanceof RulrWarning) return 'Warning';
  return typeof w;
};

const describeWarnings = (warnings: readonly unknown[]): unknown[] => warnings.map((w) => {
  if (!(w instanceof RulrWarning)) return { kind: kind(w), raw: w, message: messageFromWarning(w) };
  const out: Record<string, unknown> = { kind: kind(w), name: w.name, message: messageFromWarning(w), warningMessage: w.message, path: w.path, data: tag(w.data) };
  if (w instanceof XapiTypeWarning) out.typeName = w.typeName;
  if (w instanceof RulrTypeWarning) out.type = w.type.name;
  if (w instanceof RulrRestrictedKeysWarning) out.keys = w.keys;
  return out;
});

const errorResult = (err: unknown, withMessage: boolean): unknown =>
  withMessage ? { thrown: (err as Error).name, message: (err as Error).message } : { thrown: (err as Error).name };

const runIfi = (input: Input): unknown => {
  const path = input.path as string[];
  try {
    if (input.fn === 'validateIfi') return { warnings: describeWarnings(validateIfi(input.ifi as { key?: unknown }, path)) };
    const fn = input.fn === 'validateIfis' ? assertValidIfis : assertValidIfi;
    return { returned: tag(fn(input.ifi as { key?: unknown }, path)) };
  } catch (err) {
    if (err instanceof RulrWarnings) return { thrown: 'Warnings', message: messageFromWarning(err), path: err.path, data: tag(err.data), warnings: describeWarnings(err.warnings) };
    return { thrown: (err as Error).name };
  }
};

const run = async (input: Input): Promise<unknown> => {
  switch (input.route) {
    case 'password': {
      const settings = input.settings as PasswordSettings;
      if (input.fn === 'util') {
        try {
          return validatePasswordUtil(input.value as string, settings);
        } catch (err) {
          return errorResult(err, true);
        }
      }
      try {
        return {
          valid: await validatePassword({
            value: input.value as string,
            modified: input.modified !== false,
            settings,
            history: input.history as PasswordHistoryItem[],
            comparePassword: (value, hash) => Promise.resolve(hash === `h:${value}`),
          }),
        };
      } catch (err) {
        return errorResult(err, true);
      }
    }
    case 'ifi': return runIfi(input);
    case 'ifiUi':
      try {
        return { hasErrors: hasIdentifierValueErrors(input.type, input.value) };
      } catch (err) {
        return errorResult(err, false);
      }
    default: throw new Error(`route inconnue : ${input.route}`);
  }
};

describe('validation : oracle legacy', () => {
  it('reproduit tous les cas (messages compris)', async () => {
    expect(oracle.cases.length).toBeGreaterThan(400);
    const { identical, failures } = await compareCases(oracle.cases, run);
    expect(failures, `${String(identical)} / ${String(oracle.cases.length)} cas identiques\n${failures.slice(0, 15).join('\n')}`).toEqual([]);
  });
});
