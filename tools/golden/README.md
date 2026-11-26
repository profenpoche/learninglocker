# Capture « golden » (contrat de l'API)

Enregistre les couples requête/réponse de la pile legacy sur un scénario qui couvre toutes les
routes de l'API Learning Locker et du service xAPI. On rejoue ensuite le même scénario sur la pile
2026 et on compare réponse par réponse. Voir [docs/07-plan-execution.md](../../docs/07-plan-execution.md),
lot 1 et §7.

Le scénario part toujours de l'état exact d'un instantané du jeu de test
([tools/seed](../seed/README.md)) : mêmes documents et mêmes `_id` des deux côtés.

## Fichiers

| Fichier | Rôle |
|---|---|
| `scenario.mjs` | Les requêtes, groupées en sections (identifiant stable par cas). Lectures sur l'état de l'instantané, puis écritures. |
| `record.mjs` | Joue le scénario contre une pile et écrit l'enregistrement. |
| `diff.mjs` | Compare deux enregistrements cas par cas. |
| `lib/runner.mjs` | Profils d'authentification, exécution, écriture. |
| `lib/normalize.mjs` | Remplace ce qui change d'une exécution à l'autre par des repères stables. |
| `restore-legacy.sh` | Remet la pile legacy dans l'état de l'instantané (base, fichiers, Redis, récepteur de forwarding). |
| `record-legacy.sh` | Restauration, service presave, enregistrement ; `CHECK=1` enregistre deux fois et compare. |

## Ce qui est couvert

- **Authentification** : login (succès, échecs), jetons d'organisation (dont organisation expirée), refresh par cookie, jetons expirés ou mal signés (fabriqués avec `APP_SECRET`), jeton en query string, clients Basic, OAuth2 `client_credentials`, réinitialisation de mot de passe.
- **Modèles REST** (19 modèles) : liste, comptage, lecture, `shallow`, pagination Relay (2 pages), index ; paramètres `query` (`$oid`, `$dte`, regex), `select`, `skip`, `distinct`, `populate`, erreurs.
- **Matrice des droits** : 15 profils (admin, organisation, 4 utilisateurs à rôles, 6 clients, client invalide, jeton expiré, anonyme) × 15 routes de lecture.
- **Statements** : comptages, agrégations (clés `&46;`, `$lookup` autorisé ou refusé, `$out`, `limit`/`skip`, v1, asynchrone), utilisateur filtré, clients d'autres stores.
- **Pipelines du front** : pour chacune des 30 visualisations, les pipelines calculés par le code React (date figée à la date de référence du jeu de test), puis leur résultat d'agrégation ; mêmes pipelines avec un filtre de partage. Les pipelines sont aussi la référence de la future bibliothèque partagée (lot 4) : `pipelines.json`.
- **Dashboards partagés** : rendu serveur pour chaque mode de partage (NOWHERE, ANYWHERE, ANY, VALID_DOMAINS avec Referer valide ou non, JWT), lien ancien format, puis jeton dashboard (lecture du dashboard, pipeline étranger refusé, pipeline exact accepté).
- **Personas** : personas, identifiants, attributs, pagination, CSV d'erreurs d'import, droits.
- **Téléchargements** : logo, export CSV (jeton et cookie).
- **xAPI** : `about`, statements (par id, annulés, groupes, sous-statements, pièces jointes multipart, pagination `more`, tous les filtres, formats, droits par client, OAuth, versions), state, profils d'activité et d'agent, activités, agents.
- **Écritures** : statements (POST, PUT, conflit 409, annulation, droits), state (fusion, suppression), profils (préconditions ETag), métadonnées, suppressions, puis création/modification/suppression de chaque type de document (stores, clients, rôles, utilisateurs et réglages d'organisation, organisations et logo, visualisations, dashboards et partages, forwarding, requêtes, exports), personas (création, identifiants, upsert, attributs, import JSON et CSV, fusion), réglages du site.

Les anomalies connues (doc 06 §9) sont enregistrées telles quelles. Quand la pile 2026 les
corrige (décision D7), l'écart est attendu : on liste ces cas dans un fichier passé à
`diff.mjs --accept`.

## Normalisation

| Valeur | Repère |
|---|---|
| ObjectId créé pendant l'enregistrement | `<new-id:N>` (ordre d'apparition) |
| Date postérieure au début de l'enregistrement | `<now>` |
| JWT | `<jwt {revendications} ttl=…>` (sans `iat`/`exp`) |
| `errorId` | `<errorId>` |
| Clés et jetons générés (hors manifeste) | `<secret:N>` |
| Frontière multipart | `<boundary>` |
| Binaire | empreinte SHA-256 et taille |
| Page HTML du rendu de dashboard | taille et jetons qu'elle contient |

Seuls quelques en-têtes sont comparés (type, disposition, ETag, version xAPI, cookies…).
Les clés d'objets sont triées : l'ordre des champs JSON n'est pas comparé, celui des tableaux l'est.

## Utilisation (sur la VM)

```bash
cd ~/legacy
CHECK=1 ./golden/record-legacy.sh     # enregistre deux fois et compare : doit donner 0 écart
```

Enregistrement : `snapshots/<instantané>/golden/<date>/` avec `cases.ndjson` (normalisé, sert à la
comparaison), `raw.ndjson` (réponses brutes, pour le diagnostic), `pipelines.json`, `meta.json`.

Pour la pile 2026 (même instantané restauré, même `APP_SECRET`) :

```bash
LL_BASE=http://localhost REFERENCE=snapshots/latest/golden/latest MANIFEST=snapshots/latest/manifest.json \
  node golden/record.mjs /tmp/candidat
node golden/diff.mjs snapshots/latest/golden/latest /tmp/candidat --accept golden/accepted.json
```

Sans service presave, les pipelines du front sont relus dans `pipelines.json` de la référence
(`REFERENCE`). Le seul cas qui calcule un pipeline à l'instant présent (jeton dashboard) est alors
sauté.
