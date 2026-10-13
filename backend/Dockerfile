# Layered so a deploy only rebuilds what changed: dependencies are cached until
# package.json/yarn.lock change, the docs until docs/ changes.
FROM node:16.20.2-bullseye-slim AS deps
WORKDIR /app
# mongodb-memory-server (tests only) would download a MongoDB binary on install
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-engines --network-timeout 600000 && yarn cache clean

FROM deps AS build
COPY tsconfig.json ./
COPY src src
RUN yarn build-ts

FROM deps AS prod-deps
RUN yarn install --frozen-lockfile --ignore-engines --production --network-timeout 600000 && yarn cache clean

FROM python:3.12-slim AS docs
RUN pip install --no-cache-dir mkdocs-material==9.5.50
COPY docs /docs
RUN cd /docs && mkdocs build --quiet

FROM node:16.20.2-bullseye-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules node_modules
COPY package.json ./
COPY locales locales
COPY --from=docs /docs/site docs/site
COPY --from=build /app/dist dist
EXPOSE 1337 3000
CMD ["node", "dist/server.js"]
