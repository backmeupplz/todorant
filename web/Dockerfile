# The static app, served by nginx; TODORANT_API (the backend URL) is applied at start by docker-entrypoint.sh
FROM --platform=$BUILDPLATFORM node:22-slim AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# nginx's workers can only serve world-readable files, whatever the checkout's umask was
RUN npm run build && chmod -R a+rX dist

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.d/40-todorant.sh
COPY --from=build /web/dist /usr/share/nginx/html
