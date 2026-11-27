// Chargement du fichier .env, avec la sémantique de dotenv 2.0.0 (bannière webpack du bundle legacy :
// `dotenv.config()` relatif au répertoire courant). L'ancien .env doit être lu à l'identique.
// Code d'origine : legacy/lib/tools/getWebpackConfig.js (bannière) et node_modules/dotenv@2.0.0/lib/main.js.
//
// Différences avec process.loadEnvFile() de Node, volontairement évitées :
// - pas de commentaire en fin de ligne : `CLE=valeur # note` vaut `valeur # note` ;
// - une variable déjà définie mais vide dans l'environnement est remplacée par celle du fichier
//   (`process.env[cle] = process.env[cle] || valeur`).
import { readFileSync } from 'node:fs';

const LINE = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/;

/** dotenv 2.0.0 `parse` : une ligne `CLE=VALEUR` par variable, guillemets retirés, `\n` développé entre guillemets doubles. */
export const parseEnvFile = (source: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of source.split('\n')) {
    const match = LINE.exec(line);
    if (!match) continue;
    const key = match[1] ?? '';
    let value = match[2] ?? '';
    if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) {
      value = value.replace(/\\n/gm, '\n');
    }
    value = value.replace(/(^['"]|['"]$)/g, '').trim();
    out[key] = value;
  }
  return out;
};

/**
 * dotenv 2.0.0 `config` : lit le fichier s'il existe et complète l'environnement.
 * Renvoie les variables lues, ou null si le fichier est absent (dotenv 2 l'écrivait sur stderr).
 */
export const loadEnvFile = (path: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> | null => {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseEnvFile(source);
  for (const [key, value] of Object.entries(parsed)) {
    env[key] = env[key] || value;
  }
  return parsed;
};
