# Jeu de données de test (pile legacy)

Génère, sur la pile legacy (Learning Locker v2 `master` + xapi-service v7.1.2, MongoDB 4.2, Redis 4),
un jeu de données qui couvre chaque type de document et chaque cas particulier connu, puis en fait
un instantané. Cet instantané sert de référence pour les tests de migration vers la version 2026
(voir [docs/07-plan-execution.md](../../docs/07-plan-execution.md), lot 1).

Principe : **tout passe par les API publiques**, pour que les documents soient écrits par le code
d'origine (API, worker, xapi-service). Les rares formes de données qu'aucune API actuelle ne produit
(héritages v1, champs `old*`) sont injectées ensuite par `legacy-quirks.js`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `run-legacy.sh` | Remet la pile à zéro, applique les migrations, crée l'admin, lance tout, exécute le seed, puis produit l'instantané. |
| `launch-detached.sh` | Lance `run-legacy.sh` détaché de la session SSH (journal `seed-run.log`). `stop` arrête une passe en cours. |
| `seed.mjs` | Orchestrateur (Node ≥ 22) : appels API dans l'ordre d'un utilisateur réel. |
| `statements.mjs` | Générateur déterministe de statements xAPI 1.0.3 (graine fixe, mulberry32). |
| `legacy/presave-server.js` | Service HTTP exécuté **dans l'image legacy** (babel-node) : appelle le vrai code de sérialisation du front React (`schemas.preSave`, `buildModel` des 13 modèles de visualisation). |
| `legacy-quirks.js` | Script mongosh : formes de données héritées (dates en chaîne, visualisation `axes` JSON, ancienne collection `personaidentifiers`, statement v1, filtres `old*`, champs de partage à la racine d'un dashboard). |

## Lancement (sur la VM)

Organisation sur la VM, dans `~/legacy` :

```
~/legacy/
  docker-compose.yml, *.Dockerfile, *.env, nginx.conf, echo-server.mjs   ← deploy/legacy/
  seed/                                                                   ← tools/seed/
  verify-db/                                                              ← tools/verify-db/
  src/learninglocker, src/xapi-service                                    ← sources construites
  snapshots/<date>/, snapshots/latest                                     ← instantanés produits
```

```bash
cd ~/legacy
./seed/launch-detached.sh                  # passe complète (15 000 statements, ~30 min)
STATEMENTS=500 ./seed/launch-detached.sh   # passe courte de validation (~3 min)
tail -f seed-run.log
./seed/launch-detached.sh stop
```

L'essentiel du temps est l'attente du worker (environ 900 statements par minute : personas,
cache du query builder, forwarding). `KEEP=1` conserve les volumes existants au lieu de repartir
d'une base vide.

## Variables de `seed.mjs`

| Variable | Défaut | |
|---|---|---|
| `LL_BASE` | `http://localhost:18080` | nginx de la pile legacy |
| `PRESAVE` | `http://localhost:18090` | service presave |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@profenpoche.test` / `Admin-Test-2026` | admin du site |
| `SEED` | `20261126` | graine du générateur |
| `STATEMENTS` | `15000` | statements ordinaires |
| `OUT` | `./seed-out` | dossier du manifeste et du CSV |

Les autres utilisateurs ont le mot de passe `Utilisateur-Test-2026`. Tous les identifiants
(clients, clés Basic, utilisateurs, visualisations, dashboards…) sont dans `manifest.json`.

Déterminisme : même graine = mêmes acteurs, verbes, activités et identifiants de statements.
Les dates sont relatives à la date du lancement (`referenceDate` dans le manifeste) : deux passes
à des jours différents ne produisent donc pas les mêmes horodatages.

## Contenu généré

- **Organisation** : fuseau Europe/Paris, règle de mot de passe, logo ; 2 sous-organisations (dont 1 expirée).
- **Stores et clients** : 2 LRS ; 7 clients (complet avec suppression, lecture seule, read/mine, state/profils, désactivé, API sans store, client du 2e LRS) ; 1 jeton OAuth2.
- **Utilisateurs et rôles** : 2 rôles personnalisés ; 4 utilisateurs (analyste, observateur, référent personas, utilisateur avec filtre de statements).
- **Forwarding** : 4 configurations vers le récepteur `echo` (Basic, jeton + pièces jointes, en erreur, désactivée). Les requêtes reçues sont dans `forwarded.ndjson`.
- **Statements** : 15 000 ordinaires (60 apprenants sur les 4 types d'IFI, 4 enseignants, cours, interactions, jeu, extensions, registrations, résultats) ; annulations, références, groupes, sous-statements, agents en objet, PUT par identifiant, renvoi identique et conflit 409, pièces jointes, `priority=LOW`, `bypassQueues`, 2e store, client `mine`, OAuth, client désactivé refusé ; 30 statements supprimés par lots.
- **xAPI documents** : states (JSON fusionné, binaire), profil d'activité, profils d'agent (JSON, texte).
- **Personas** : créées par le worker, import CSV (avec une ligne volontairement en erreur), création manuelle, identifiants mbox/account/openid, attribut, fusion.
- **Visualisations** : tous les types personnalisés et les 13 modèles, séries, fuseaux, opérateurs `$dte`/`$oid`/`$personaIdent`, une visualisation sans type.
- **Dashboards** : Getting Started, Stream Starter, vierge, personnalisé (15 widgets, partages NOWHERE, ANYWHERE, ANY, VALID_DOMAINS, JWT_SECURED), privé, public.
- **Divers** : 2 requêtes sauvegardées, export CSV téléchargé, métadonnées de statement, réglage du site.

## Instantané produit (`snapshots/<date>/`)

| Fichier | Contenu |
|---|---|
| `learninglocker_v2.archive.gz` | `mongodump --gzip --archive` de la base legacy (MongoDB 4.2) |
| `storage.tar.gz` | volume de fichiers (logos, CSV de personas, exports, states, profils, pièces jointes) |
| `inventory.json` | inventaire `tools/verify-db/inventory.js` (collections, volumes, index, types de champs) |
| `manifest.json` | identifiants, clés, comptes de test, étapes réalisées |
| `legacy-quirks.json` | identifiants des documents hérités injectés |
| `personas.csv` | CSV importé |
| `forwarded.ndjson` | requêtes reçues par le récepteur de forwarding |

Pour vérifier une migration : restaurer l'archive sur la cible, refaire l'inventaire, puis
`node tools/verify-db/compare.mjs avant.json apres.json`.
