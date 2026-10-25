# Layered so a deploy only rebuilds what changed: dependencies are cached until
# package.json/yarn.lock change, the docs until docs/ changes. Both installs share a yarn cache mount
# (locked: yarn 1's cache corrupts under concurrent installs), so a reinstall after a lockfile change
# or a build-cache eviction reuses the packages it already downloaded.
# Every stage but the last runs on the build machine's platform: their output (compiled JS,
# pure-JS node_modules with no native addons, static docs) is the same for amd64 and arm64,
# so a multi-arch build does this work once instead of again under qemu emulation.
# If a dependency with a native addon is ever added, drop --platform from prod-deps.
FROM --platform=$BUILDPLATFORM node:22.23.4-bookworm-slim AS deps
WORKDIR /app
# mongodb-memory-server (tests only) would download a MongoDB binary on install
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked yarn install --frozen-lockfile --ignore-engines --network-timeout 600000

FROM deps AS build
COPY tsconfig.json ./
COPY src src
RUN yarn build-ts

# Independent of deps, so both installs run in parallel
FROM --platform=$BUILDPLATFORM node:22.23.4-bookworm-slim AS prod-deps
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked yarn install --frozen-lockfile --ignore-engines --production --network-timeout 600000

FROM --platform=$BUILDPLATFORM python:3.12-slim AS docs
RUN pip install --no-cache-dir mkdocs-material==9.5.50
COPY docs /docs
RUN cd /docs && mkdocs build --quiet

FROM node:22.23.4-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules node_modules
COPY package.json ./
COPY locales locales
COPY --from=docs /docs/site docs/site
COPY --from=build /app/dist dist
EXPOSE 1337 3000
CMD ["node", "dist/server.js"]
