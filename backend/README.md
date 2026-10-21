# Todorant backend

The Koa and MongoDB API behind [todorant.com](https://todorant.com). It serves `/v2`, the REST endpoints and realtime WebSocket sync (`/v2/ws`) used by the current web and Android apps, alongside the original API that older clients still call. The API docs are served at `/docs/`.

## Local launch

You need Node 22 (see `.nvmrc`) and a MongoDB.

1. `cp .env.sample .env` and set at least `MONGO` and `JWT`
2. `yarn install --ignore-engines`
3. `yarn develop` starts the API on port 1337 and rebuilds on every change

Everything else is optional: each integration (Telegram bots, Facebook sign-in, error reports) stays off until its variables are set, and the log says which ones are off. [`.env.example`](../.env.example) in the repository root describes every variable.

## Tests

```sh
TEST_MONGO=mongodb://localhost:27017 JWT=test yarn jest --forceExit
```

## Deploys

A push to `main` that touches `backend/` runs the checks in `.github/workflows/backend.yml`. When they pass, the workflow moves the `deploy/backend` branch to that commit, and Easypanel builds it into backend.todorant.com. To run your own server, see the [self-hosting guide](../docs/self-hosting.md).
