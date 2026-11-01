const https = require("https");
const fs = require("fs");

const Sources = [
  {
    name: "Emotes",
    urls: [
      "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=39&Limit=30",
      "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=39&Limit=30&salesTypeFilter=1&SortType=3"
    ],
    output: "emotedata.json"
  },
  {
    name: "Animations",
    urls: [
      "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=38&salesTypeFilter=1&Limit=30"
    ],
    output: "animationdata.json"
  },
  {
    name: "Moods",
    urls: [
      "https://catalog.roproxy.com/v1/search/items/details?Category=66&Limit=30"
    ],
    output: "mooddata.json"
  }
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadData(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const items = (JSON.parse(fs.readFileSync(filePath, "utf8")).data || []).map((item) => ({
        ...item,
        description: typeof item.description === "string" ? item.description : ""
      }));
      return { items, ids: new Set(items.map((i) => i.id)) };
    }
  } catch {
    log(`Error reading ${filePath}, starting fresh`);
  }
  return { items: [], ids: new Set() };
}

function saveData(items, filePath) {
  try {
    const normalizedItems = items.map((item) => ({
      ...item,
      description: typeof item.description === "string" ? item.description : ""
    }));
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          keyword: null,
          totalItems: normalizedItems.length,
          lastUpdate: new Date().toISOString(),
          data: normalizedItems
        },
        null,
        2
      ),
      "utf8"
    );
    return true;
  } catch (err) {
    log(`Save error for ${filePath}: ${err.message}`);
    return false;
  }
}

async function fetchJSON(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
          if (res.statusCode !== 200) {
            clearTimeout(timeout);
            req.destroy();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }

          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            clearTimeout(timeout);
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error("JSON parse error"));
            }
          });
        });

        const timeout = setTimeout(() => {
          req.destroy();
          reject(new Error("Request timeout"));
        }, 30000);

        req.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function fetchCatalog(url, name, existingData, isMoods) {
  const allItems = [];
  let cursor = "";
  let page = 0;
  let newCount = 0;
  let duplicateCount = 0;

  try {
    do {
      page++;
      log(`${name} - Page ${page}`);

      const requestUrl = cursor ? `${url}&Cursor=${encodeURIComponent(cursor)}` : url;
      const res = await fetchJSON(requestUrl);

      if (!Array.isArray(res.data)) {
        log(`${name} - Invalid response data`);
        break;
      }

      for (const item of res.data) {
        if (isMoods) {
          for (const bundledItem of item.bundledItems || []) {
            if (bundledItem.type !== "Asset" || bundledItem.assetType !== 78 || typeof bundledItem.id !== "number" || typeof bundledItem.name !== "string") {
              continue;
            }

            if (existingData.ids.has(bundledItem.id)) {
              duplicateCount++;
              continue;
            }

            allItems.push({
              id: bundledItem.id,
              name: bundledItem.name,
              description: typeof bundledItem.description === "string" ? bundledItem.description : ""
            });
            existingData.ids.add(bundledItem.id);
            newCount++;
          }

          continue;
        }

        if (existingData.ids.has(item.id)) {
          duplicateCount++;
          continue;
        }

        const record = {
          id: item.id,
          name: item.name,
          description: typeof item.description === "string" ? item.description : ""
        };

        if (item.bundledItems?.length) {
          const bundled = {};
          let counter = 1;

          for (const b of item.bundledItems) {
            if (b.type !== "UserOutfit" && b.id) {
              const key = String(counter++);
              bundled[key] = bundled[key] || [];
              bundled[key].push(b.id);
            }
          }

          if (Object.keys(bundled).length > 0) {
            record.bundledItems = bundled;
          }
        }

        allItems.push(record);
        existingData.ids.add(item.id);
        newCount++;
      }

      cursor = res.nextPageCursor;

      log(`${name} - Page ${page} complete | New: ${newCount} | Duplicates: ${duplicateCount}`);

      if (cursor && cursor.trim() !== "") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } while (cursor && cursor.trim() !== "");
  } catch (err) {
    log(`Error in ${name}: ${err.message}`);
  }

  return { items: allItems, newCount, duplicateCount };
}

async function processAPIs() {
  const start = Date.now();
  log("Starting combined update...");

  const results = {};

  for (const source of Sources) {
    const filePath = source.output;
    log(`Processing ${filePath}...`);

    const existingData = loadData(filePath);
    const allItems = [...existingData.items];

    let newTotal = 0;
    let dupTotal = 0;
    const isMoods = filePath === "mooddata.json";

    for (const url of source.urls) {
      const result = await fetchCatalog(url, source.name, existingData, isMoods);
      allItems.push(...result.items);
      newTotal += result.newCount;
      dupTotal += result.duplicateCount;
      log(`${source.name} - New: ${result.newCount}, Duplicates: ${result.duplicateCount}`);
    }

    const saved = saveData(allItems, filePath);
    results[filePath] = { success: saved, total: allItems.length, newTotal, dupTotal };
    log(`${filePath} - Total: ${allItems.length}, New: ${newTotal}`);
  }

  log(`All updates complete - Duration: ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return results;
}

async function main() {
  log("Starting catalog-sniper update...");

  try {
    const results = await processAPIs();
    let allOk = true;

    for (const [filePath, result] of Object.entries(results)) {
      if (!result.success) {
        allOk = false;
        log(`Failed to save ${filePath}`);
      } else {
        log(`✓ ${filePath}: ${result.total} items (${result.newTotal ?? 0} new)`);
      }
    }

    log(allOk ? "catalog-sniper completed successfully" : "catalog-sniper completed with some errors");
    process.exit(allOk ? 0 : 1);
  } catch (err) {
    log(`catalog-sniper error: ${err.message}`);
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  log(`Unhandled error: ${reason}`);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

main();
