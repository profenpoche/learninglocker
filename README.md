# Learning Locker 2026

Migration de [Learning Locker v2](legacy/README.md) (LRS xAPI) vers une version maintenue :
Node.js 24 LTS, MongoDB 8, backend TypeScript, front Angular, déploiement sur Ubuntu Server LTS.
Exigence centrale : **compatibilité à 100 % des données et de la configuration** des instances existantes.

Travail en cours. Le plan, les décisions et l'avancement sont dans
[docs/07-plan-execution.md](docs/07-plan-execution.md).

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `packages/shared` | Code commun à l'API, au worker et au front (formats de données, pipelines d'agrégation) |
| `apps/` | API, worker, CLI, front Angular (ajoutés au fil des lots) |
| `legacy/` | Code Learning Locker d'origine (commit `5fec948a`), **référence intacte** pour le portage |
| `docs/` | Documentation technique, contrats, plan de migration |
| `deploy/` | Provisionnement Ubuntu, pile legacy en conteneurs |
| `tools/` | Jeu de test, tests de contrat « golden », vérification de base |

Le service xAPI est un projet séparé :
[profenpoche/learninglocker-xapi-service](https://github.com/profenpoche/learninglocker-xapi-service) (branche `v2026`).

## Développement

Node.js 24 (`.nvmrc`) :

```bash
npm ci
npm run check      # lint, typage, tests, syntaxe des outils
npm run build
```

Consignes pour les contributeurs et les agents de code : [AGENTS.md](AGENTS.md).

## Licence

GPL-3.0, comme Learning Locker ([LICENSE](LICENSE)).
