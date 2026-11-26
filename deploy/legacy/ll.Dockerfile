# Learning Locker v2 (branche master, état 2021) : image de référence.
# Construite avec les outils d'époque : Node 10, yarn 1, webpack 3, babel 6.
#
# Image stretch (gcc 6) et non buster (gcc 8) : le module natif grpc 1.9
# (via @google-cloud/pubsub 0.16, chargé au démarrage même avec QUEUE_PROVIDER=REDIS)
# ne compile pas avec gcc 8 (-Werror), et ses binaires précompilés ne sont plus
# téléchargeables (403). Après l'échec du téléchargement, node-pre-gyp lance deux
# compilations concurrentes dans le même dossier et le build échoue : on force donc
# la compilation directe depuis les sources. Le .yarnrc du dépôt le demande déjà,
# mais yarn ne le transmet pas aux scripts d'installation : il faut la variable.
FROM node:10-stretch

ENV npm_config_build_from_source=true

WORKDIR /opt/ll

# Dépendances d'abord, pour profiter du cache Docker.
COPY package.json yarn.lock .yarnrc ./
RUN yarn install --frozen-lockfile --ignore-engines --network-timeout 600000

COPY . .
# Le build lit .env : on en fournit un vide, la configuration vient de l'environnement.
RUN touch .env && yarn build-all

ENV NODE_ENV=production
CMD ["node", "api/dist/server"]
