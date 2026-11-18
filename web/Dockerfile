# The static app, served by nginx; TODORANT_API (the backend URL) is applied at start by docker-entrypoint.sh
FROM --platform=$BUILDPLATFORM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# nginx's workers can only serve world-readable files, whatever the checkout's umask was
RUN npm run build && chmod -R a+rX dist

FROM nginx:alpine@sha256:0563c36f94a6d3ec3584161b77859f740f7e20b4853f52c796a864ce6908e8ea
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.d/40-todorant.sh
COPY --from=build /web/dist /usr/share/nginx/html
