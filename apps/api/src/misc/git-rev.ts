// Version du code via git, comme le paquet git-rev 0.2.1 de l'API legacy : sortie de la commande,
// retours à la ligne supprimés, chaîne vide en cas d'échec (pas de dépôt git, git absent…).
// Code d'origine : node_modules/git-rev@0.2.1/index.js (appelé par legacy/api/src/routes/HttpRoutes.js).
import { execFile } from 'node:child_process';

const run = (args: string[]): Promise<string> => new Promise((resolve) => {
  execFile('git', args, (_error, stdout) => {
    resolve(stdout.split('\n').join(''));
  });
});

export const gitVersion = async (): Promise<{ short: string; long: string; branch: string; tag: string }> => {
  const [short, long, branch, tag] = await Promise.all([
    run(['rev-parse', '--short', 'HEAD']),
    run(['rev-parse', 'HEAD']),
    run(['rev-parse', '--abbrev-ref', 'HEAD']),
    run(['describe', '--always', '--tag', '--abbrev=0']),
  ]);
  return { short, long, branch, tag };
};
