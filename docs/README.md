# Documentation technique de Learning Locker v2

Documentation du code de ce dépôt (commit `5fec948a`, novembre 2021 ; sur la branche `v2026`, ce code se trouve sous `legacy/` et les chemins cités ici s'y rapportent), rédigée pour préparer une version « 2026 ». Cette version vise une compatibilité totale des données et de la configuration, un nouveau front Angular, Node.js et MongoDB à jour, et un déploiement sur Ubuntu Server LTS.

## Sommaire

| Document | Contenu | À lire pour… |
|---|---|---|
| [01-architecture.md](01-architecture.md) | Processus, flux d'un statement, organisation du dépôt, stack actuelle, build | Comprendre le système en 10 minutes |
| [02-donnees.md](02-donnees.md) | Modèles et collections MongoDB champ par champ, index, migrations, clés Redis, stockage de fichiers, contrat avec xapi-service, fonctions MongoDB dépréciées | La compatibilité des données |
| [03-api-auth.md](03-api-auth.md) | Toutes les routes HTTP, JWT et cookies, scopes et filtres d'autorisation, formats d'erreur, pagination, tests existants | Le contrat que le nouveau backend et le nouveau front doivent respecter |
| [04-worker-cli-config.md](04-worker-cli-config.md) | Worker et files de messages, statement forwarding, scheduler, commandes CLI, **inventaire complet des variables d'environnement**, pm2, nginx, build | La compatibilité de la configuration et des traitements asynchrones |
| [05-front.md](05-front.md) | Écrans et routes, types de visualisation, query builder, construction des pipelines d'agrégation, formats sérialisés | La spécification fonctionnelle du front Angular |
| [06-migration-2026.md](06-migration-2026.md) | Versions cibles, checklist des contrats, choix recommandés, montée de version MongoDB, déploiement Ubuntu, plan par phases, anomalies à trancher, questions ouvertes | Planifier la version 2026 |
| [07-plan-execution.md](07-plan-execution.md) | État de la VM, décisions, architecture cible sur la VM, lots de travail avec critères de sortie, jalons, stratégie de test, risques | Exécuter la version 2026 |

## Documentation associée

xapi-service (fork `profenpoche/learninglocker-xapi-service`) est documenté dans son propre dépôt, branche `v2026`, dossier `docs/`.

## Les points à retenir

1. **L'endpoint xAPI n'est pas dans ce dépôt.** `/data/xAPI` est servi par **xapi-service**, un projet séparé qui partage la base MongoDB et Redis. Il fait partie du périmètre de la migration.
2. **Redis est obligatoire** : xapi-service y signale les nouveaux statements au worker.
3. **Les pipelines d'agrégation des visualisations sont construits par le front**, et le serveur réutilise ce code pour autoriser les dashboards partagés. C'est la logique la plus risquée à porter : il faut l'extraire dans une bibliothèque partagée.
4. **Beaucoup de champs sont du JSON stocké en chaîne** (filtres, axes, autorité des clients…) avec des opérateurs maison (`$oid`, `$dte`, `$personaIdent`). Leur format doit être conservé.
5. **Presque toutes les dépendances sont incompatibles avec Node 24/26 et MongoDB 8/9**, en particulier persona-service, qui embarque le driver Mongo 2.2. Le document 06 recommande une réécriture TypeScript à contrat figé par des tests boîte noire.
6. **Plusieurs failles de sécurité existent** : hash de mot de passe renvoyé par l'API, réglages du site modifiables par tous, secret de filtre exposé, pipelines non filtrés. Voir [06-migration-2026.md §9](06-migration-2026.md).

## Méthode

La documentation a été établie par lecture du code source. Les dépendances `@learninglocker/*` ont été lues dans leurs paquets npm publiés. Rien n'a été exécuté : les comportements signalés « à vérifier » doivent être confirmés sur une instance qui tourne, ce qui est l'objet de la phase 0 du plan.
