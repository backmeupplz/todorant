# Self-hosting Todorant

Run your own Todorant: the same backend that powers todorant.com, the web app and a MongoDB database, on a server you control. The Android app connects to it as well.

## What you get

- **Backend**: the API with realtime sync, on port `1337`
- **Web app**: the full Todorant web app, on port `8080`
- **MongoDB**: your data, kept in a Docker volume
- **Email + password accounts**, so you don't have to set up Google, Apple or Telegram apps

The images are published to GitHub Container Registry for `linux/amd64` and `linux/arm64`: `ghcr.io/backmeupplz/todorant-backend` and `ghcr.io/backmeupplz/todorant-web`. A Raspberry Pi 5 runs it as is. On a Pi 4, change the database image in `docker-compose.yml` to `mongo:4.4`, because newer MongoDB needs a newer CPU.

## Quick start

You need Docker with the Compose plugin.

```sh
mkdir todorant && cd todorant
curl -fsSLO https://raw.githubusercontent.com/backmeupplz/todorant/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/backmeupplz/todorant/main/.env.example -o .env
# JWT signs every sign-in: make it long and random
sed -i.bak "s/^JWT=.*/JWT=$(openssl rand -hex 32)/" .env && rm .env.bak
docker compose up -d
```

Open http://localhost:8080, choose **Sign in**, enter an email and a password of 8 characters or more, and press **Create account**. That's all.

Working from a clone of this repository instead? Run `cp .env.example .env`, set `JWT`, then `docker compose up -d --build` in the repository root to build the images from source.

## Reaching it from other devices

The web app calls the backend straight from your browser, so `TODORANT_API` has to be the backend's address as your browser (or phone) sees it. The default, `http://localhost:1337`, only works on the server itself.

- **At home**: use the server's IP address, for example `TODORANT_API=http://192.168.1.10:1337`, and open `http://192.168.1.10:8080`.
- **On the internet**: put both behind a reverse proxy with HTTPS (see below) and set `TODORANT_API=https://api.todo.example.com`.

After editing `.env`, run `docker compose up -d` to apply it.

### HTTPS with a reverse proxy

Give the web app and the backend a hostname each. With [Caddy](https://caddyserver.com), which gets the certificates by itself, the whole config is:

```
todo.example.com {
	reverse_proxy localhost:8080
}

api.todo.example.com {
	reverse_proxy localhost:1337
}
```

Any proxy works as long as it passes WebSocket upgrades on `/v2/ws`, which is how the apps sync live. Caddy and Traefik do that out of the box; nginx needs `proxy_http_version 1.1` plus the `Upgrade` and `Connection` headers.

With a proxy in front, publish the ports on localhost only so that nobody can skip it: in `docker-compose.yml`, change `1337:1337` to `127.0.0.1:1337:1337` and `8080:80` to `127.0.0.1:8080:80`.

## Configuration

Settings live in `.env`, and [`.env.example`](../.env.example) explains every line. After a change, run `docker compose up -d`.

| Variable | Default | What it does |
| --- | --- | --- |
| `JWT` | none, required | The secret that signs sign-in tokens. Changing it signs everyone out |
| `MONGO` | `mongodb://mongo:27017/todorant` | MongoDB connection string. The default is the compose file's own database |
| `TODORANT_API` | `http://localhost:1337` | The backend address that the web app calls. The web image on its own defaults to `https://backend.todorant.com` |
| `PASSWORD_SIGNUP` | `true` | Set it to `false` to stop new email + password sign-ups |
| `SMTP_URL`, `MAIL_FROM`, `MAIL_REPLY_TO` | empty | An SMTP server (`smtps://user:password@smtp.example.com:465`), the sender address and, optionally, where replies go. Once set, a sign-up emails a confirmation link, built from `BACKEND_URL` or else `TODORANT_API`, and the account exists once it's opened |

The optional integrations below have their own variables, and they stay off while those are empty.

## The Android app

1. Open **Settings → Server**, or tap **Server** at the bottom of the sign-in screen.
2. Enter your backend's address, the same one as `TODORANT_API`: for example `https://api.todo.example.com`, or `http://192.168.1.10:1337` at home.
3. Sign in with your email and password, or create the account right there.

Changing the server signs you out of the previous one. Clearing the field takes you back to todorant.com.

## Optional integrations

Each integration stays off until its variables are set. When the backend starts, its log says which of the Telegram ones are off.

| Integration | Variables | What it needs |
| --- | --- | --- |
| Error reports in Telegram | `TELEGRAM_ERROR_SENDER_TOKEN`, `CHAT_ID` | A bot from [@BotFather](https://t.me/BotFather) and the chat it should post to. Without them, errors go to `docker compose logs backend` |
| Telegram bot | `TELEGRAM_LOGIN_TOKEN`, `WIT_LANGUAGES` | Your own bot, for accounts that signed in with Telegram: they can add todos by messaging it. The apps' Telegram sign-in uses the official @todorant_bot, so most servers skip this. Voice messages also need [wit.ai](https://wit.ai) tokens and ffmpeg, which the image doesn't include |
| Facebook sign-in | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Only for apps built with your own Facebook app |

Signing in with Google, Apple, Facebook or Telegram goes through Todorant's own apps and domain, so on your server people sign in with email and password. The web and Android apps put that option first whenever they're pointed at a server other than todorant.com.

## Updating

```sh
docker compose pull
docker compose up -d
```

`latest` follows the main branch. Every `v…` tag of this repository is published as well: to stay on one release, replace `latest` with that tag in `docker-compose.yml`.

## Backups

Everything is in MongoDB. To back it up:

```sh
docker compose exec -T mongo mongodump --archive --gzip > todorant-$(date +%F).gz
```

To restore a backup (this replaces the current data):

```sh
docker compose exec -T mongo mongorestore --archive --gzip --drop < todorant-2026-10-13.gz
```

Running the backup daily from cron and keeping copies on another machine is a good habit.

## Running without Docker

**Backend**: Node 16 and MongoDB.

```sh
cd backend
MONGOMS_DISABLE_POSTINSTALL=1 yarn install --frozen-lockfile --ignore-engines
yarn build-ts
MONGO=mongodb://localhost:27017/todorant JWT=your-secret node dist/server.js
```

The backend also reads its settings from `backend/.env`. It listens on port 1337.

**Web app**: Node 22.

```sh
cd web
npm ci
VITE_API=https://api.todo.example.com npm run build
```

Serve `web/dist` with any static file server that answers unknown paths with `index.html`; `dist/404.html` is the same page, for hosts such as GitHub Pages. `VITE_API` is built in, including the page's Content-Security-Policy, so rebuild after changing it.

## Security

- **Use HTTPS** for anything that leaves your home network: passwords and sign-in tokens travel with every request.
- **Keep `JWT` secret.** Whoever has it can sign in as any account. If it leaks, change it and everyone signs in again.
- **Close sign-ups** once your accounts exist: set `PASSWORD_SIGNUP=false` and run `docker compose up -d`. Otherwise anyone who can reach the backend can create an account.
- **Keep MongoDB private.** The compose file doesn't publish its port, and it has no password, so leave it that way.
- **Back up** regularly, as described above.

## Troubleshooting

- `docker compose logs backend` shows what the backend is doing, including errors and which integrations are off.
- If the web app loads but signing in fails, your browser can't reach `TODORANT_API`. Open `<TODORANT_API>/docs/` in the browser: it should show the API docs.
- If the backend keeps restarting, `JWT` is probably missing from `.env`.
