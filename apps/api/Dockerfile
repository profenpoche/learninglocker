# syntax=docker/dockerfile:1
# Image de l'API Learning Locker 2026. Contexte de construction : la racine du monorepo.
#   docker build -f apps/api/Dockerfile -t ll-api:v2026 .
# Configuration : mêmes variables d'environnement que l'API legacy (ll.env), API_PORT obligatoire.
# LEGACY_API_URL (facultatif) : relais des routes non portées vers l'API legacy.

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @ll/shared --workspace @ll/api --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @ll/shared && npm run build --workspace @ll/api

FROM node:24-bookworm-slim AS deps
WORKDIR /opt/learninglocker
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @ll/shared --workspace @ll/api --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /opt/learninglocker
COPY --from=deps /opt/learninglocker ./
COPY --from=build /src/packages/shared/dist packages/shared/dist
COPY --from=build /src/apps/api/dist apps/api/dist
COPY apps/api/templates apps/api/templates
# Utilisateur non privilégié de l'image node (uid 1000).
USER node
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]
