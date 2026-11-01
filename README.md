<div align="center">

<img src="public/assets/banner.svg" alt="Catalog Sniper" width="100%">

<br>

A free JSON API for Roblox catalog emotes, animations, and moods.

[Get Script](https://kei-scripts.vercel.app/script/fe-emotes-14) | [Docs](https://catalog-sniper.vercel.app) | [Lua example](example.lua)

</div>

---

## API

| Dataset    | Endpoint         |
| ---------- | ---------------- |
| Emotes     | `/api/emotes`    |
| Animations | `/api/animation` |
| Moods      | `/api/moods`     |

Every endpoint accepts these query parameters:

| Parameter | Default | Description                                                      |
| --------- | ------- | ---------------------------------------------------------------- |
| `page`    | `1`     | Page number.                                                     |
| `limit`   | `50`    | Results per page. The maximum is `200`.                          |
| `search`  | none    | Case-insensitive search across names and descriptions.           |

Each result has an `id`, a `name`, and a `description`. If the source has no description, it is an empty string. Extra fields such as `bundledItems` and `custom` are kept as they are.

Example request:

```
/api/emotes?page=2&limit=25&search=moon%20walk
```

```json
{
  "data": [{ "id": 123, "name": "Moon Walk", "description": "" }],
  "pagination": { "page": 2, "limit": 25, "total": 31, "hasMore": true }
}
```

The full datasets are still available as downloads in `public/v1/` (`emotedata.json`, `animationdata.json`, `mooddata.json`), along with `info.json` for counts and last-synced times.

## Lua example

[`example.lua`](example.lua) is a standalone script for Delta and other executors. It loads the first page when you run it and supports server-side search and page sizes of 25, 50, 100, or 200. It also caches pages in memory and ignores outdated responses. You can hook its callbacks up to your own UI.

## How it works

A GitHub Actions workflow runs every hour. It updates and normalizes the source datasets, then rebuilds the search indexes. The Vercel functions use those trigram indexes to narrow down substring searches on the server.

## Project structure

```
.
├── .github/workflows/main.yml
├── api/
│   ├── emotes.js
│   ├── animation.js
│   └── moods.js
├── assets/
│   ├── banner.svg
│   └── logo.png
├── generated/search-indexes/   built from public/v1
├── lib/catalog-api.js
├── public/
│   ├── index.html
│   ├── style.css
│   └── v1/
│       ├── info.json
│       ├── emotedata.json
│       ├── animationdata.json
│       └── mooddata.json
├── scripts/build-search-index.js
├── example.lua
├── main.js
└── README.md
```
