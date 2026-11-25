# Welcome to Todorant Backend Documentation

## General Notes

- API runs at [https://backend.todorant.com](https://backend.todorant.com), or on your own server ([self-hosting guide](https://github.com/backmeupplz/todorant/blob/main/docs/self-hosting.md))
- The current apps talk to the [REST API (v2)](methods/v2.md) and its WebSocket sync. For scripts and tools, create a personal API token in Settings → API tokens in the web app and send it as `Authorization: Bearer tdr_…`
- The original API ([Public](methods/public.md) and [Private](methods/private.md) methods) is still served for older clients. There you sign private requests with a token in the `token` header; an API token works there too

## Links

- [Telegram chat](https://t.me/todorant_feedback)
- [Source code](https://github.com/backmeupplz/todorant)
