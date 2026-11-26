# AGENTS.md

Consignes pour les agents de code (et les humains) qui travaillent sur ce dépôt.
Format ouvert [AGENTS.md](https://agents.md) : ce fichier est la source unique de ces consignes.

## Projet

Learning Locker v2 (LRS xAPI) migré vers une version « 2026 » : Node 24 LTS, MongoDB 8, front Angular,
backend TypeScript, déploiement Ubuntu Server LTS. Exigence centrale : **compatibilité à 100 % des
données et de la configuration** avec les instances existantes.

- `master` : code Learning Locker d'origine, **référence intacte**. On n'y développe pas.
- `v2026` : tout le travail de migration. Monorepo npm :
  - `packages/shared` : code commun (formats de données, pipelines d'agrégation) ;
  - `apps/` : API, worker, CLI, front Angular, ajoutés au fil des lots ;
  - `legacy/` : copie du code d'origine, pour le lire pendant le portage. Ne jamais la modifier ;
    elle est exclue du lint, du typage et des tests. Les chemins cités dans `docs/` (`api/src/…`,
    `lib/…`, `ui/src/…`) se trouvent sous `legacy/` sur cette branche.
- Le service xAPI (`/data/xAPI`) est un projet séparé : fork `profenpoche/learninglocker-xapi-service`.

## Où lire

| Besoin | Fichier |
|---|---|
| Comprendre le système, les contrats de données, d'API, de configuration | `docs/README.md` puis `docs/01` à `docs/05` |
| Cibles, anomalies à corriger ou reproduire | `docs/06-migration-2026.md` |
| Plan, **décisions D1–D8 (tranchées)**, lots, avancement | `docs/07-plan-execution.md` (§3 et §9) |
| Jeu de données de test | `tools/seed/README.md` |
| Tests de contrat « golden » | `tools/golden/README.md` |
| Vérification de base avant/après migration | `tools/verify-db/` (`inventory.js`, `compare.mjs`) |
| Pile legacy en conteneurs, provisionnement Ubuntu | `deploy/legacy/`, `deploy/provision.sh` |

## Commandes

Node 24 (`.nvmrc`), npm workspaces :

```bash
npm ci
npm run check        # tout ce que la CI vérifie : lint, typage, tests, syntaxe des outils
npm test             # Vitest, tous les paquets
npm run build
```

Pile technique : TypeScript 6.0 strict (version imposée par Angular 22 et typescript-eslint ;
TypeScript 7 attendra leur prise en charge), ESLint 10 (configuration « flat »), Vitest 5.
CI : `.github/workflows/ci.yml` (GitHub Actions).

## Règles

- **Ne jamais changer un format de données ou de configuration** sans l'avoir vérifié dans `docs/02`, `docs/03` et `docs/04` : noms de collections, champs JSON stockés en chaîne, opérateurs `$oid`/`$dte`/`$personaIdent`, encodage `&46;`, bcrypt, JWT HS256 avec `APP_SECRET`, noms de files, variables d'environnement.
- Un comportement de l'API est validé quand `tools/golden/diff.mjs` ne montre aucun écart avec la référence legacy. Les écarts voulus (failles corrigées, décision D7) sont listés dans `tools/golden/accepted.json`, avec leur justification dans `docs/07`.
- Les pipelines d'agrégation doivent être identiques à ceux du front React : référence `pipelines.json` de l'enregistrement golden.
- Commits : [Conventional Commits](https://www.conventionalcommits.org) (`.commitlintrc.json`), par exemple `feat(api): …`, `docs: …`.
- Documentation en français. Langage simple, phrases courtes.
- Ne pas commiter de données : instantanés, dumps, enregistrements golden (ils vivent sur la VM, voir plus bas). Les secrets présents dans `deploy/legacy/*.env` sont des valeurs de test, jamais à réutiliser.
- Code nouveau : TypeScript strict, tests Vitest à côté du code (`*.test.ts`). Chaque portage cite le
  fichier d'origine sous `legacy/` en commentaire d'en-tête.
- Outils `tools/` : JavaScript (ESM) exécuté sur la VM ou dans l'image legacy ; `npm run check:tools`
  en vérifie la syntaxe. Le code legacy (`legacy/`) se construit avec Node 10, uniquement en conteneur.

## Environnement de travail (VM)

VM Ubuntu Server 24.04 sous GNOME Boxes, provisionnée par `deploy/provision.sh`.

- Accès : `ssh -p 2222 sam@localhost` (sudo sans mot de passe).
- **Fermer Boxes arrête la VM.** La fenêtre doit rester ouverte (réduite si besoin).
- La redirection du port SSH est ajoutée à chaud et **disparaît à chaque redémarrage de la VM**. Pour la remettre (sur l'hôte) :
  `flatpak run --command=virsh org.gnome.Boxes -c qemu:///session qemu-monitor-command ubuntu24.04- --hmp 'hostfwd_add hostnet0 tcp:127.0.0.1:2222-:22'`
- Pile legacy dans `~/legacy` (copies de `deploy/legacy/`, `tools/seed/` → `seed/`, `tools/golden/` → `golden/`, `tools/verify-db/` → `verify-db/`). nginx legacy sur le port 18080 de la VM, MongoDB 4.2 sur 27018, Redis 4 sur 6380. MongoDB 8.0 et Redis 7 de la cible sur les ports standard.
- Instantané de référence : `~/legacy/snapshots/latest` (dump, fichiers, manifeste, inventaire) ; référence golden : `~/legacy/snapshots/latest/golden/latest`.
- Après modification d'un fichier de `tools/` ou `deploy/legacy/`, recopier la version locale sur la VM : les deux doivent rester identiques.

Commandes usuelles, depuis `~/legacy` sur la VM :

```bash
./seed/launch-detached.sh                 # régénère le jeu de test (≈ 35 min), détaché de SSH
STATEMENTS=500 ./seed/launch-detached.sh  # passe courte (≈ 3 min) pour valider une modification
./seed/launch-detached.sh stop
./golden/restore-legacy.sh                # remet la pile dans l'état de l'instantané
CHECK=1 ./golden/record-legacy.sh         # refait la référence golden et contrôle son déterminisme
```

## Pièges connus

- Tâches longues : les lancer détachées (`setsid`, voir `seed/launch-detached.sh`) et attendre sur leur PID. Une coupure SSH tue sinon le processus.
- Ne pas utiliser `pkill -f <motif>` dans une commande SSH : le motif correspond aussi à la ligne de commande du shell distant, qui se tue lui-même.
- `commande | tail` masque le code de sortie de `commande` : afficher `rc=$?` avant le filtre.
- Le worker legacy traite 300 à 1 200 statements par minute (MongoDB est le goulot) et continue d'écrire quelques minutes après : attendre une base stable avant tout instantané.
- Les routes legacy `/api/v2/<modèle>/:id/shallow` ne répondent jamais : toujours un délai maximal côté client.
