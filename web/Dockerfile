# The static app, served by nginx; TODORANT_API (the backend URL) is applied at start by docker-entrypoint.sh
FROM --platform=$BUILDPLATFORM node:22-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# nginx's workers can only serve world-readable files, whatever the checkout's umask was
RUN npm run build && chmod -R a+rX dist

FROM nginx:alpine@sha256:7fc0fb4af7bf006aeb31aea88069976060f8f0a0a86b667126742cc17f4e31ae
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.d/40-todorant.sh
COPY --from=build /web/dist /usr/share/nginx/html
