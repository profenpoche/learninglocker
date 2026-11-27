import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnvFile, parseEnvFile } from './env-file.js';

describe('parseEnvFile (dotenv 2.0.0)', () => {
  it('lit les lignes CLE=VALEUR, retire les guillemets et garde les commentaires de fin de ligne', () => {
    expect(parseEnvFile([
      '# commentaire',
      'A=1',
      '  B = deux  ',
      'C="trois\\nlignes"',
      "D='quatre'",
      'E=',
      'F=valeur # pas un commentaire',
      'G.H-I=ok',
      'ligne invalide',
    ].join('\n'))).toEqual({
      A: '1', B: 'deux', C: 'trois\nlignes', D: 'quatre', E: '', F: 'valeur # pas un commentaire', 'G.H-I': 'ok',
    });
  });

  it('ne développe \\n qu’entre guillemets doubles', () => {
    expect(parseEnvFile("A='x\\ny'")).toEqual({ A: 'x\\ny' });
  });
});

describe('loadEnvFile', () => {
  it('complète l’environnement sans écraser une valeur non vide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'll-env-'));
    const path = join(dir, '.env');
    writeFileSync(path, 'A=fichier\nB=fichier\nC=fichier\n');
    const env: NodeJS.ProcessEnv = { A: 'processus', B: '' };
    expect(loadEnvFile(path, env)).toEqual({ A: 'fichier', B: 'fichier', C: 'fichier' });
    expect(env).toEqual({ A: 'processus', B: 'fichier', C: 'fichier' });
  });

  it('renvoie null si le fichier est absent', () => {
    expect(loadEnvFile('/chemin/inexistant/.env', {})).toBeNull();
  });
});
