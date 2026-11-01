"use strict";

/**
 * Shared request handler for the paginated catalog endpoints.
 *
 * Query parameters:
 *   page    Page number, starting at 1 (default: 1)
 *   limit   Results per page, any positive integer (default: 50)
 *   search  Case-insensitive search across names and descriptions
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;

// Largest page size a caller can request. Use Infinity for no cap.
// Vercel functions cannot return more than ~4.5 MB per response.
const MAX_LIMIT = 500;

// Number of search queries remembered per dataset.
const QUERY_CACHE_SIZE = 16;

/**
 * Lowercases, trims, and collapses whitespace so searches are consistent.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Parses a query value as a positive integer, or returns the fallback.
 * @param {string | null} value
 * @param {number} fallback
 * @returns {number}
 */
function parsePositiveInteger(value, fallback) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Small least-recently-used cache.
 * @param {number} maxSize
 */
function createLruCache(maxSize) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.set(key, value);
      if (entries.size > maxSize) {
        entries.delete(entries.keys().next().value);
      }
    }
  };
}

/**
 * Splits a query into overlapping three-character grams.
 * @param {string} query
 * @returns {string[]}
 */
function toTrigrams(query) {
  const characters = Array.from(query);
  const grams = [];
  for (let i = 0; i <= characters.length - 3; i++) {
    grams.push(characters.slice(i, i + 3).join(""));
  }
  return grams;
}

/**
 * Uses the trigram index to find the smallest set of records worth checking.
 * Returns null when the query is too short to use the index.
 * @param {string} query
 * @param {Record<string, number[]>} index
 * @returns {number[] | null}
 */
function getCandidates(query, index) {
  let candidates = null;
  for (const gram of toTrigrams(query)) {
    const postings = index[gram];
    if (!postings) return [];
    if (candidates === null || postings.length < candidates.length) {
      candidates = postings;
    }
  }
  return candidates;
}

/**
 * Builds the dataset-specific search function.
 * Normalized text is computed once, when the function starts up.
 */
function createSearcher(records, index) {
  const names = records.map((record) => normalizeSearchText(record.name));
  const descriptions = records.map((record) => normalizeSearchText(record.description));
  const cache = createLruCache(QUERY_CACHE_SIZE);

  /**
   * @param {string} query Normalized search text
   * @returns {number[]} Matching record positions
   */
  return function search(query) {
    const cached = cache.get(query);
    if (cached) return cached;

    const candidates = getCandidates(query, index);
    const matches = [];
    const check = (position) => {
      if (names[position].includes(query) || descriptions[position].includes(query)) {
        matches.push(position);
      }
    };

    if (candidates === null) {
      for (let position = 0; position < records.length; position++) check(position);
    } else {
      for (const position of candidates) check(position);
    }

    cache.set(query, matches);
    return matches;
  };
}

function setHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
}

/**
 * Creates a Vercel handler for one dataset.
 * @param {string} datasetName Used in error logs
 * @param {object[]} records Dataset entries
 * @param {Record<string, number[]>} index Trigram index for the dataset
 */
function createHandler(datasetName, records, index) {
  const search = createSearcher(records, index);

  return function handler(req, res) {
    setHeaders(res);

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const page = parsePositiveInteger(params.get("page"), DEFAULT_PAGE);
      const limit = Math.min(parsePositiveInteger(params.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
      const query = normalizeSearchText(params.get("search"));

      const start = (page - 1) * limit;
      const end = start + limit;
      let data;
      let total;

      if (query) {
        const matches = search(query);
        total = matches.length;
        data = matches.slice(start, end).map((position) => records[position]);
      } else {
        total = records.length;
        data = records.slice(start, end);
      }

      return res.status(200).json({
        data,
        pagination: { page, limit, total, hasMore: start + data.length < total }
      });
    } catch (error) {
      console.error(`Catalog API error (${datasetName}):`, error);
      return res.status(500).json({ error: "Catalog data is temporarily unavailable" });
    }
  };
}

module.exports = { createHandler, normalizeSearchText };
