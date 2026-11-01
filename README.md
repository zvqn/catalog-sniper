# Catalog Sniper

A Roblox catalog data API providing paginated emotes, animations, and moods, with the existing full JSON files retained for compatibility.

### URL

[https://catalog-sniper.vercel.app](https://catalog-sniper.vercel.app)

---

# Folder Structure
```
Catalog Sniper
│
├── .github/
│   └── workflows/
│       └── main.yml
│
├── public/
│   ├── index.html
│   ├── style.css
│   │
│   ├── docs/
│   │   ├── index.html
│   │   └── style.css
│   │
│   └── v1/
│       ├── info.json
│       ├── emotedata.json
│       ├── animationdata.json
│       └── mooddata.json
│
├── api/
│   ├── emotes.js
│   ├── animation.js
│   └── moods.js
├── generated/
│   └── search-indexes/     # Built from public/v1 datasets
├── lib/
│   └── catalog-api.js
├── scripts/
│   └── build-search-index.js
├── example.lua             # script example
├── main.js
└── README.md
```

## Paginated API

The Vercel functions expose these endpoints:

| Dataset | Endpoint |
| --- | --- |
| Emotes | `/api/emotes` |
| Animations | `/api/animation` |
| Moods | `/api/moods` |

Each endpoint accepts `page` (default `1`), `limit` (default `50`, maximum `200`), and `search`. Search is case-insensitive, whitespace-normalized, and matches names and descriptions. Each result has `id`, `name`, and `description`; records without source descriptions use an empty string. Existing fields such as `bundledItems` and `custom` are preserved.

Example: `/api/emotes?page=2&limit=25&search=moon%20walk`

```json
{
  "data": [{ "id": 123, "name": "Moon Walk", "description": "" }],
  "pagination": { "page": 2, "limit": 25, "total": 31, "hasMore": true }
}
```

`public/v1/*.json` remain available as legacy full-dataset downloads. Vercel API functions use generated trigram indexes to narrow server-side substring search. The hourly GitHub Actions workflow rebuilds those indexes immediately after updating and normalizing all source datasets.

## Script example

[`example.lua`](example.lua) is a standalone executor example. It loads the first page on run, supports server-side search and page sizes of 25, 50, 100, or 200, caches pages in memory, ignores stale responses, and exposes callbacks to connect to existing UI controls.
