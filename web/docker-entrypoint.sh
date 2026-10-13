#!/bin/sh
# Runs before nginx starts: points the app at TODORANT_API (config.js) and lets the page's CSP connect to it
set -e
api=${TODORANT_API:-https://backend.todorant.com}
api=${api%/}
case $api in
  http://* | https://*) ;;
  *) echo "TODORANT_API must be an http:// or https:// URL, got '$api'" >&2; exit 1 ;;
esac
origin=$(echo "$api" | sed -E 's|^(https?://[^/?#]+).*|\1|')
cd /usr/share/nginx/html
printf 'window.TODORANT_API = "%s"\n' "$api" > config.js
sed -i "s#https://backend.todorant.com#$origin#g; s#wss://backend.todorant.com#$(echo "$origin" | sed 's/^http/ws/')#g" index.html 404.html
echo "Todorant web: backend at $api"
