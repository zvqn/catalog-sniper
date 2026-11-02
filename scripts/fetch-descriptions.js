"use strict";

/**
 * Fills in missing descriptions for records already saved in public/v1.
 *
 * main.js only reads descriptions from the catalog list, and it skips ids it
 * has already saved, so records saved with an empty description never get a
 * second look. This script goes back to them. It looks up each empty record on
 * its own, writes the description in, and remembers which ids it has checked so
 * the next run continues where this one stopped.
 *
 * Run it with: DATA_DIR=public/v1 node scripts/fetch-descriptions.js
 * Set BATCH_SIZE to change how many records one run checks (default 1000).
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DataDirectory = process.env.DATA_DIR || process.cwd();
const StateFile = path.join(__dirname, "..", "generated", "description-state.json");
const BatchSize = Number.parseInt(process.env.BATCH_SIZE, 10) || 1000;

const RequestDelay = 300;
const RequestTimeout = 30000;
const RequestRetries = 4;
const SaveEvery = 100;

const Files = ["emotedata.json", "animationdata.json", "mooddata.json"];

const Lookups = {
  asset: {
    url: (id) => `https://economy.roproxy.com/v2/assets/${id}/details`,
    read: (body) => body.Description
  },
  bundle: {
    url: (id) => `https://catalog.roproxy.com/v1/bundles/details?bundleIds=${id}`,
    read: (body) => (Array.isArray(body) ? body[0]?.description : undefined)
  }
};

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------- network

function request(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "catalog-sniper" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") });
      });
    });

    req.setTimeout(RequestTimeout, () => req.destroy(new Error("Request timeout")));
    req.on("error", reject);
  });
}

/** Waits between requests and retries rate limits and server errors. */
async function fetchWithRetry(url) {
  await sleep(RequestDelay);

  for (let attempt = 1; attempt <= RequestRetries; attempt++) {
    let response;
    try {
      response = await request(url);
    } catch (error) {
      if (attempt === RequestRetries) throw error;
      await sleep(2000 * attempt);
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === RequestRetries) throw new Error(`HTTP ${response.status}`);
      await sleep(5000 * attempt);
      continue;
    }
    return response;
  }
}

/**
 * Looks up one record's description.
 * Returns a string (possibly empty), or null if no endpoint knows the id.
 */
async function lookupDescription(record) {
  const order = record.bundledItems ? ["bundle", "asset"] : ["asset", "bundle"];

  for (const kind of order) {
    const lookup = Lookups[kind];
    const response = await fetchWithRetry(lookup.url(record.id));
    if (response.status !== 200) continue;

    let body;
    try {
      body = JSON.parse(response.text);
    } catch {
      continue;
    }

    const description = lookup.read(body);
    if (typeof description === "string") return description;
  }
  return null;
}

// ---------------------------------------------------------------- storage

/** Ids that were checked and still have no description, per dataset file. */
function loadState() {
  try {
    if (fs.existsSync(StateFile)) return JSON.parse(fs.readFileSync(StateFile, "utf8"));
  } catch {
    log("Could not read description state, starting fresh");
  }
  return {};
}

function saveState(state) {
  fs.mkdirSync(path.dirname(StateFile), { recursive: true });
  fs.writeFileSync(StateFile, `${JSON.stringify(state)}\n`);
}

function saveDataset(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

// ---------------------------------------------------------------- main

async function main() {
  const state = loadState();
  const stats = { checked: 0, filled: 0, empty: 0, unavailable: 0 };
  let remaining = BatchSize;
  let stopped = false;

  for (const file of Files) {
    const filePath = path.join(DataDirectory, file);
    if (!fs.existsSync(filePath)) {
      log(`${file} not found, skipping`);
      continue;
    }

    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const checked = new Set(state[file] || []);
    const pending = payload.data.filter((record) => !record.description && !checked.has(record.id));
    log(`${file}: ${pending.length} records still need a description`);

    let unsaved = 0;
    const persist = () => {
      if (unsaved === 0) return;
      saveDataset(filePath, payload);
      state[file] = [...checked];
      saveState(state);
      unsaved = 0;
    };

    for (const record of pending) {
      if (remaining <= 0) break;

      let description;
      try {
        description = await lookupDescription(record);
      } catch (error) {
        log(`Lookup failed for ${record.id}: ${error.message}. Stopping, progress is saved.`);
        stopped = true;
        break;
      }

      remaining--;
      stats.checked++;
      unsaved++;

      if (description === null) {
        stats.unavailable++;
        checked.add(record.id);
      } else if (description.trim() === "") {
        stats.empty++;
        checked.add(record.id);
      } else {
        record.description = description;
        stats.filled++;
      }

      if (unsaved >= SaveEvery) persist();
    }

    persist();
    if (stopped || remaining <= 0) break;
  }

  log(
    `Done: ${stats.checked} checked, ${stats.filled} filled, ` +
    `${stats.empty} confirmed empty, ${stats.unavailable} not found`
  );

  if (stopped && stats.checked === 0) process.exitCode = 1;
}

main().catch((error) => {
  log(`fetch-descriptions error: ${error.message}`);
  process.exit(1);
});
