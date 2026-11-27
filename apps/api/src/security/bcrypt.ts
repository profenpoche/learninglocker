// bcrypt compatible avec les empreintes existantes (bcryptjs 2.4.3 du legacy : préfixe $2a$, coût 8).
// bcryptjs 3 produit par défaut des empreintes $2b$ (même algorithme) : on garde $2a$.
import bcrypt from 'bcryptjs';

export const BCRYPT_ROUNDS = 8;

export const hashLegacy = async (value: string, rounds = BCRYPT_ROUNDS): Promise<string> => {
  const salt = (await bcrypt.genSalt(rounds)).replace(/^\$2b\$/, '$2a$');
  return bcrypt.hash(value, salt);
};

/** bcrypt.compare ; faux (sans erreur) si l'empreinte est absente ou invalide, comme bcryptjs 2. */
export const compareHash = async (value: string, hash: unknown): Promise<boolean> => {
  if (typeof hash !== 'string') return false;
  try {
    return await bcrypt.compare(value, hash);
  } catch {
    return false;
  }
};
