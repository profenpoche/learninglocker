# xapi-service v7.1.2 (fork profenpoche, master) : image de référence, Node 16.
FROM node:16-bullseye

WORKDIR /opt/xapi

COPY package.json yarn.lock ./
COPY patches ./patches
RUN yarn install --frozen-lockfile --ignore-engines --network-timeout 600000

COPY . .
RUN yarn build

CMD ["node", "dist/server.js"]
