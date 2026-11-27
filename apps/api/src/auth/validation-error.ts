// Erreur de validation au format JSON de Mongoose 5 (renvoyée telle quelle par l'API legacy), sans
// les piles d'appel (chemins internes du serveur legacy, impossibles et inutiles à reproduire).
import type mongoose from 'mongoose';

interface LegacyValidatorError {
  message: string;
  name: 'ValidatorError';
  properties: { message: string; type: string; path: string; value: unknown; reason?: { message: string } };
  kind: string;
  path: string;
  value: unknown;
  reason?: { message: string };
}

export const legacyValidationError = (error: mongoose.Error.ValidationError) => {
  const errors: Record<string, LegacyValidatorError> = {};
  const modelName = /^(.*) validation failed/.exec(error.message)?.[1] ?? 'Validation';
  for (const [path, item] of Object.entries(error.errors)) {
    const reason = (item as { reason?: unknown }).reason;
    const reasonMessage = reason instanceof Error ? { message: reason.message } : undefined;
    const kind = (item as { kind?: string }).kind ?? 'user defined';
    errors[path] = {
      message: item.message,
      name: 'ValidatorError',
      properties: { message: item.message, type: kind, path, value: (item as { value?: unknown }).value, ...(reasonMessage ? { reason: reasonMessage } : {}) },
      kind,
      path,
      value: (item as { value?: unknown }).value,
      ...(reasonMessage ? { reason: reasonMessage } : {}),
    };
  }
  const details = Object.entries(errors).map(([path, item]) => `${path}: ${item.message}`).join(', ');
  return {
    errors,
    _message: `${modelName} validation failed`,
    message: `${modelName} validation failed: ${details}`,
    name: 'ValidationError',
  };
};
