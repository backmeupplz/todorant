# The static app, served by nginx; TODORANT_API (the backend URL) is applied at start by docker-entrypoint.sh
FROM --platform=$BUILDPLATFORM node:22-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# nginx's workers can only serve world-readable files, whatever the checkout's umask was
RUN npm run build && chmod -R a+rX dist

FROM nginx:alpine@sha256:b50897d5c7b1aa08067c3d90c5e8b3e47ec4e3c91c91446f67820228f7b41e34
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.d/40-todorant.sh
COPY --from=build /web/dist /usr/share/nginx/html
