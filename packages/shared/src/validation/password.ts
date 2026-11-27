// Règles de mot de passe des utilisateurs (réglages de l'organisation propriétaire).
// Code d'origine : legacy/lib/utils/validators/User.js (validatePasswordUtil), legacy/lib/models/user.js
// (validateur du champ password, historique dans preSavePasswordCheck), validator 5.7.0 (isLength).
// La comparaison bcrypt est injectée : la bibliothèque ne dépend pas de bcrypt.

/** Réglages `PASSWORD_*` de organisation.settings (valeurs par défaut du modèle : voir DEFAULT_PASSWORD_SETTINGS). */
export interface PasswordSettings {
  PASSWORD_HISTORY_CHECK?: unknown;
  PASSWORD_HISTORY_TOTAL?: unknown;
  PASSWORD_MIN_LENGTH?: unknown;
  PASSWORD_REQUIRE_ALPHA?: unknown;
  PASSWORD_REQUIRE_NUMBER?: unknown;
  PASSWORD_USE_CUSTOM_REGEX?: unknown;
  PASSWORD_CUSTOM_REGEX?: unknown;
  PASSWORD_CUSTOM_MESSAGE?: unknown;
}

/** Valeurs par défaut du schéma mongoose (lib/models/organisation.js, settings). */
export const DEFAULT_PASSWORD_SETTINGS = {
  PASSWORD_HISTORY_CHECK: true,
  PASSWORD_HISTORY_TOTAL: 3,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_REQUIRE_ALPHA: true,
  PASSWORD_REQUIRE_NUMBER: true,
  PASSWORD_USE_CUSTOM_REGEX: false,
  PASSWORD_CUSTOM_REGEX: null,
  PASSWORD_CUSTOM_MESSAGE: null,
} as const satisfies PasswordSettings;

// validator.isLength(str, { min }) de validator 5.7.0 : une paire de substitution compte pour un caractère.
const isLength = (value: unknown, min: unknown): boolean => {
  if (typeof value !== 'string') throw new TypeError('This library (validator.js) validates strings only');
  const surrogatePairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? [];
  const length = value.length - surrogatePairs.length;
  return length >= ((min as number | undefined) || 0);
};

export interface PasswordCheck {
  success: boolean;
  messages: string[];
}

/**
 * Vérifie un mot de passe en clair. Un mot de passe vide n'est jamais vérifié (il ne modifie pas le
 * document). Une expression personnalisée valide remplace les règles « lettre » et « chiffre » (pas la
 * longueur) ; invalide, elle est ignorée. Messages identiques à l'original (affichés tels quels).
 *
 * Écart possible : l'expression est compilée par le moteur courant ; une syntaxe récente (groupes
 * nommés en double, modificateurs `(?i:…)`) refusée par Node 10 y est acceptée.
 */
export const validatePasswordUtil = (value: string, settings: PasswordSettings): PasswordCheck => {
  let success = true;
  const messages: string[] = [];

  if ((value as { length: number }).length > 0) {
    if (!isLength(value, settings.PASSWORD_MIN_LENGTH)) {
      success = false;
      messages.push(`The password must be at least ${String(settings.PASSWORD_MIN_LENGTH)} characters long`);
    }

    let hasValidCustomPattern = false;
    let customPattern: RegExp | undefined;
    // Comme l'original : TypeError si l'expression est activée mais nulle.
    if (settings.PASSWORD_USE_CUSTOM_REGEX && (settings.PASSWORD_CUSTOM_REGEX as { length: number }).length > 0) {
      try {
        customPattern = new RegExp(settings.PASSWORD_CUSTOM_REGEX as string);
        hasValidCustomPattern = true;
      } catch {
        hasValidCustomPattern = false;
      }
    }

    if (hasValidCustomPattern && customPattern) {
      if (!customPattern.test(value)) {
        const settingsMessage = settings.PASSWORD_CUSTOM_MESSAGE as { length: number } | null | undefined;
        const hasMessage = settingsMessage ? settingsMessage.length > 0 : false;
        success = false;
        messages.push(hasMessage ? settings.PASSWORD_CUSTOM_MESSAGE as string : 'The password does not meet this organisations minimum requirements');
      }
    } else {
      if (settings.PASSWORD_REQUIRE_ALPHA && !/[a-zA-Z]/.test(value)) {
        success = false;
        messages.push('The password must include at least one letter');
      }
      if (settings.PASSWORD_REQUIRE_NUMBER && !/[0-9]/.test(value)) {
        success = false;
        messages.push('The password must include at least one number');
      }
    }
  }

  return { success, messages };
};

/** Entrée de user.passwordHistory. */
export interface PasswordHistoryItem {
  date?: unknown;
  hash?: unknown;
}

// _.sortBy(collection, 'date') : compareAscending de lodash, tri stable.
const compareAscending = (value: unknown, other: unknown): number => {
  if (value !== other) {
    const valIsDefined = value !== undefined;
    const valIsNull = value === null;
    const valIsReflexive = value === value;
    const valIsSymbol = typeof value === 'symbol';
    const othIsDefined = other !== undefined;
    const othIsNull = other === null;
    const othIsReflexive = other === other;
    const othIsSymbol = typeof other === 'symbol';
    const gt = (a: unknown, b: unknown): boolean => (a as number) > (b as number);
    if ((!othIsNull && !othIsSymbol && !valIsSymbol && gt(value, other))
      || (valIsSymbol && othIsDefined && othIsReflexive && !othIsNull && !othIsSymbol)
      || (valIsNull && othIsDefined && othIsReflexive)
      || (!valIsDefined && othIsReflexive)
      || !valIsReflexive) {
      return 1;
    }
    // (ici value est réflexive : sinon la branche précédente a déjà renvoyé 1)
    if ((!valIsNull && !valIsSymbol && !othIsSymbol && gt(other, value))
      || (othIsSymbol && valIsDefined && !valIsNull && !valIsSymbol)
      || (othIsNull && valIsDefined)
      || !othIsDefined
      || !othIsReflexive) {
      return -1;
    }
  }
  return 0;
};

export const sortByDate = <T extends PasswordHistoryItem>(history: readonly T[] | null | undefined): T[] =>
  (history ?? [])
    .map((item, index) => ({ item, index, date: (item as T | null | undefined)?.date }))
    .sort((a, b) => compareAscending(a.date, b.date) || a.index - b.index)
    .map(({ item }) => item);

export interface ValidatePasswordArgs {
  /** Valeur en clair proposée. */
  value: string;
  /** Faux si le champ n'a pas été modifié (c'est alors l'empreinte : rien à vérifier). */
  modified?: boolean;
  /** Réglages de l'organisation propriétaire (user.ownerOrganisationSettings). */
  settings: PasswordSettings;
  /** user.passwordHistory. */
  history?: readonly PasswordHistoryItem[] | null;
  /** bcrypt.compare(valeur, empreinte). */
  comparePassword: (value: string, hash: unknown) => Promise<boolean>;
}

/**
 * Validateur du champ password : renvoie true, ou lève une Error dont le message réunit les messages
 * (séparés par « , »), plus celui de l'historique si la valeur reprend l'un des N derniers mots de passe
 * (N = PASSWORD_HISTORY_TOTAL, si PASSWORD_HISTORY_CHECK). Ce message est renvoyé par l'API.
 */
export const validatePassword = async ({ value, modified = true, settings, history, comparePassword }: ValidatePasswordArgs): Promise<true> => {
  if (!modified) return true;
  if ((value as { length: number }).length < 1) return true;

  const result = validatePasswordUtil(value, settings);
  const shouldTestHistoryCheck = settings.PASSWORD_HISTORY_CHECK && (settings.PASSWORD_HISTORY_TOTAL as number) > 0;

  if (shouldTestHistoryCheck) {
    const sortedHistory = sortByDate(history).slice(-1 * (settings.PASSWORD_HISTORY_TOTAL as number));
    for (const item of sortedHistory) {
      const matched = await comparePassword(value, item.hash);
      if (matched) {
        throw new Error([
          ...result.messages,
          `This is one of your last ${String(settings.PASSWORD_HISTORY_TOTAL)} passwords - please use a different password.`,
        ].join(', '));
      }
    }
  }

  if (result.success) return true;
  throw new Error(result.messages.join(', '));
};

/**
 * Historique après l'enregistrement d'un nouveau mot de passe (preSavePasswordCheck) : entrées
 * complètes (hash et date) conservées, nouvelle entrée ajoutée, puis seules les `total` plus récentes
 * gardées (triées par date) si la limite est dépassée.
 */
export const nextPasswordHistory = <T extends PasswordHistoryItem>(history: readonly T[] | null | undefined, entry: T, total: unknown): T[] => {
  const filtered = (history ?? []).filter((item) => Object.hasOwn(item, 'hash') && Object.hasOwn(item, 'date'));
  filtered.push(entry);
  if (filtered.length > (total as number)) {
    return sortByDate(filtered).slice(filtered.length - (total as number));
  }
  return filtered;
};
