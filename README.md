# Todorant

[Todorant](https://todorant.com) is a todo manager that uses behavioral psychology to help you get things done.

| Directory | What |
| --- | --- |
| [`backend`](backend) | Koa + MongoDB API at backend.todorant.com: the legacy API used by older clients, plus `/v2` (lean REST and realtime WebSocket sync with field-level conflict resolution) |
| [`android`](android) | Native Kotlin/Compose Android app (`com.todorant`), syncs over `/v2` |

The backend and Android histories were imported from [todorant-backend](https://github.com/backmeupplz/todorant-backend) and the private native rewrite. The React Native app and the old Vue frontend live on in their archived repos.
