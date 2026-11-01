const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const CACHE_SIZE = 16;
const queryCaches = new Map();

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function parsePositiveInteger(value, fallback) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getMatches(datasetName, query, records, index) {
  if (!query) return null;
  const cacheKey = `${datasetName}\u0000${query}`;
  if (queryCaches.has(cacheKey)) {
    const cached = queryCaches.get(cacheKey);
    queryCaches.delete(cacheKey);
    queryCaches.set(cacheKey, cached);
    return cached;
  }

  const characters = Array.from(query);
  let candidates = null;
  if (characters.length >= 3) {
    for (let offset = 0; offset <= characters.length - 3; offset++) {
      const gram = characters.slice(offset, offset + 3).join("");
      const postings = index[gram];
      if (!postings) {
        candidates = [];
        break;
      }
      if (candidates === null || postings.length < candidates.length) {
        candidates = postings;
      }
    }
  }

  const ordinals = candidates === null
    ? records.map((_, ordinal) => ordinal)
    : candidates;
  const matches = [];
  for (const ordinal of ordinals) {
    const record = records[ordinal];
    if (
      normalizeSearchText(record.name).includes(query) ||
      normalizeSearchText(record.description).includes(query)
    ) {
      matches.push(ordinal);
    }
  }

  queryCaches.set(cacheKey, matches);
  if (queryCaches.size > CACHE_SIZE) {
    queryCaches.delete(queryCaches.keys().next().value);
  }
  return matches;
}

function createHandler(datasetName, records, index) {
  return function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const page = parsePositiveInteger(params.get("page"), 1);
      const requestedLimit = parsePositiveInteger(params.get("limit"), DEFAULT_LIMIT);
      const limit = Math.min(requestedLimit, MAX_LIMIT);
      const query = normalizeSearchText(params.get("search"));
      const matches = getMatches(datasetName, query, records, index);
      const total = matches === null ? records.length : matches.length;
      const start = (page - 1) * limit;
      const ordinals = matches === null
        ? null
        : matches.slice(start, start + limit);
      const data = ordinals === null
        ? records.slice(start, start + limit)
        : ordinals.map((ordinal) => records[ordinal]);

      return res.status(200).json({
        data,
        pagination: {
          page,
          limit,
          total,
          hasMore: start + data.length < total
        }
      });
    } catch (error) {
      console.error(`Catalog API error (${datasetName}):`, error);
      return res.status(500).json({ error: "Catalog data is temporarily unavailable" });
    }
  };
}

module.exports = { createHandler, normalizeSearchText };
