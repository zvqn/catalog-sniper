"use strict";

/**
 * Fetches Roblox catalog data and merges it into the JSON dataset files.
 *
 * Existing records are kept, new ones are appended, and duplicates are skipped
 * by id. Files are written to DATA_DIR, or the current directory if it is not set.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DataDirectory = process.env.DATA_DIR || process.cwd();
const ApiBase = "https://catalog.roproxy.com/v1/search/items/details";

const RequestTimeout = 30000;
const RequestRetries = 3;
const RetryDelay = 2000;
const PageDelay = 1000;

// Asset type of the mood items bundled inside a mood listing.
const MoodAssetType = 78;

const Sources = [
  {
    name: "Emotes",
    type: "items",
    output: "emotedata.json",
    urls: [
      `${ApiBase}?Category=12&Subcategory=39&Limit=30`,
      `${ApiBase}?Category=12&Subcategory=39&Limit=30&salesTypeFilter=1&SortType=3`
    ]
  },
  {
    name: "Animations",
    type: "items",
    output: "animationdata.json",
    urls: [`${ApiBase}?Category=12&Subcategory=38&salesTypeFilter=1&Limit=30`]
  },
  {
    name: "Moods",
    type: "moods",
    output: "mooddata.json",
    urls: [`${ApiBase}?Category=66&Limit=30`]
  }
];

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Descriptions are always strings, even when the source has none. */
function toDescription(value) {
  return typeof value === "string" ? value : "";
}


/**
 * Reads a dataset file. Returns empty data if it is missing or unreadable.
 * @param {string} filePath
 */
function loadData(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const items = (payload.data || []).map((item) => ({
        ...item,
        description: toDescription(item.description)
      }));
      return { items, ids: new Set(items.map((item) => item.id)) };
    }
  } catch {
    log(`Error reading ${filePath}, starting fresh`);
  }
  return { items: [], ids: new Set() };
}

/**
 * Writes a dataset file. Returns true on success.
 * @param {object[]} items
 * @param {string} filePath
 */
function saveData(items, filePath) {
  try {
    const data = items.map((item) => ({
      ...item,
      description: toDescription(item.description)
    }));
    const payload = {
      keyword: null,
      totalItems: data.length,
      lastUpdate: new Date().toISOString(),
      data
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    return true;
  } catch (error) {
    log(`Save error for ${filePath}: ${error.message}`);
    return false;
  }
}


/**
 * GETs a URL and parses the JSON body. Rejects on non-200 or timeout.
 * @param {string} url
 */
function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("JSON parse error"));
        }
      });
    });

    request.setTimeout(RequestTimeout, () => {
      request.destroy(new Error("Request timeout"));
    });
    request.on("error", reject);
  });
}

/** Retries a request with a growing delay between attempts. */
async function fetchJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestJson(url);
    } catch (error) {
      if (attempt >= RequestRetries) throw error;
      await sleep(RetryDelay * attempt);
    }
  }
}


/**
 * Turns a catalog listing into a record. Bundled items other than outfits are
 * stored as { "1": [id], "2": [id], ... }.
 */
function parseItem(item) {
  const record = {
    id: item.id,
    name: item.name,
    description: toDescription(item.description)
  };

  const bundled = {};
  let counter = 1;
  for (const bundledItem of item.bundledItems || []) {
    if (bundledItem.type !== "UserOutfit" && bundledItem.id) {
      bundled[String(counter++)] = [bundledItem.id];
    }
  }
  if (counter > 1) record.bundledItems = bundled;

  return record;
}

/** Pulls the mood assets out of a mood listing's bundled items. */
function parseMoods(item) {
  const moods = [];
  for (const bundledItem of item.bundledItems || []) {
    const isMood =
      bundledItem.type === "Asset" &&
      bundledItem.assetType === MoodAssetType &&
      typeof bundledItem.id === "number" &&
      typeof bundledItem.name === "string";
    if (!isMood) continue;

    moods.push({
      id: bundledItem.id,
      name: bundledItem.name,
      description: toDescription(bundledItem.description)
    });
  }
  return moods;
}


/**
 * Walks every page of one catalog URL and collects records not seen before.
 * Ids are added to existingData.ids as they are found.
 */
async function fetchCatalog(url, source, existingData) {
  const items = [];
  let duplicateCount = 0;
  let cursor = "";
  let page = 0;

  try {
    do {
      page++;
      log(`${source.name} - Page ${page}`);

      const requestUrl = cursor ? `${url}&Cursor=${encodeURIComponent(cursor)}` : url;
      const response = await fetchJson(requestUrl);

      if (!Array.isArray(response.data)) {
        log(`${source.name} - Invalid response data`);
        break;
      }

      for (const listing of response.data) {
        const records = source.type === "moods" ? parseMoods(listing) : [parseItem(listing)];

        for (const record of records) {
          if (existingData.ids.has(record.id)) {
            duplicateCount++;
          } else {
            existingData.ids.add(record.id);
            items.push(record);
          }
        }
      }

      cursor = response.nextPageCursor;
      log(`${source.name} - Page ${page} complete | New: ${items.length} | Duplicates: ${duplicateCount}`);

      if (cursor && cursor.trim() !== "") await sleep(PageDelay);
    } while (cursor && cursor.trim() !== "");
  } catch (error) {
    log(`Error in ${source.name}: ${error.message}`);
  }

  return { items, newCount: items.length, duplicateCount };
}

/** Updates one dataset file from all of its source URLs. */
async function updateSource(source) {
  const filePath = path.join(DataDirectory, source.output);
  log(`Processing ${source.output}...`);

  const existingData = loadData(filePath);
  const allItems = [...existingData.items];
  let newTotal = 0;

  for (const url of source.urls) {
    const result = await fetchCatalog(url, source, existingData);
    allItems.push(...result.items);
    newTotal += result.newCount;
    log(`${source.name} - New: ${result.newCount}, Duplicates: ${result.duplicateCount}`);
  }

  const success = saveData(allItems, filePath);
  log(`${source.output} - Total: ${allItems.length}, New: ${newTotal}`);
  return { file: source.output, success, total: allItems.length, newTotal };
}

async function main() {
  const start = Date.now();
  log("Starting catalog-sniper update...");

  const results = [];
  for (const source of Sources) {
    results.push(await updateSource(source));
  }

  log(`All updates complete - Duration: ${((Date.now() - start) / 1000).toFixed(2)}s`);

  let allSaved = true;
  for (const result of results) {
    if (result.success) {
      log(`✓ ${result.file}: ${result.total} items (${result.newTotal} new)`);
    } else {
      allSaved = false;
      log(`Failed to save ${result.file}`);
    }
  }

  log(allSaved ? "catalog-sniper completed successfully" : "catalog-sniper completed with some errors");
  return allSaved;
}

if (require.main === module) {
  process.on("unhandledRejection", (reason) => {
    log(`Unhandled error: ${reason}`);
    process.exit(1);
  });
  process.on("uncaughtException", (error) => {
    log(`Uncaught exception: ${error.message}`);
    process.exit(1);
  });

  main()
    .then((allSaved) => process.exit(allSaved ? 0 : 1))
    .catch((error) => {
      log(`catalog-sniper error: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { parseItem, parseMoods };
