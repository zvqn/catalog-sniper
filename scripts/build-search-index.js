"use strict";

/**
 * Builds the trigram search indexes used by the API.
 *
 * For each dataset in public/v1 this script:
 *  1. Makes sure every record has a string `description`.
 *  2. Writes an index of three-character grams to generated/search-indexes.
 */

const fs = require("fs");
const path = require("path");
const { normalizeSearchText } = require("../lib/catalog-api");

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIRECTORY = path.join(PROJECT_ROOT, "public", "v1");
const INDEX_DIRECTORY = path.join(PROJECT_ROOT, "generated", "search-indexes");

const DATASETS = [
  { file: "emotedata.json", index: "emotes-search.json" },
  { file: "animationdata.json", index: "animation-search.json" },
  { file: "mooddata.json", index: "moods-search.json" }
];

/**
 * @param {string} value Normalized text
 * @returns {Set<string>} Every three-character gram in the text
 */
function getTrigrams(value) {
  const characters = Array.from(value);
  const grams = new Set();
  for (let offset = 0; offset <= characters.length - 3; offset++) {
    grams.add(characters.slice(offset, offset + 3).join(""));
  }
  return grams;
}

/**
 * Gives every record a string description. Returns how many were fixed.
 * @param {object[]} records
 */
function ensureDescriptions(records) {
  let fixed = 0;
  for (const record of records) {
    if (typeof record.description !== "string") {
      record.description = "";
      fixed++;
    }
  }
  return fixed;
}

/**
 * Maps each trigram to the positions of the records that contain it.
 * @param {object[]} records
 * @returns {Record<string, number[]>}
 */
function buildPostings(records) {
  const postings = Object.create(null);
  records.forEach((record, position) => {
    const searchable = normalizeSearchText(`${record.name ?? ""} ${record.description}`);
    for (const gram of getTrigrams(searchable)) {
      (postings[gram] ||= []).push(position);
    }
  });
  return postings;
}

function buildDataset({ file, index }) {
  const dataPath = path.join(DATA_DIRECTORY, file);
  const payload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  if (!Array.isArray(payload.data)) {
    throw new Error(`${dataPath} must contain a data array`);
  }

  const descriptionsFixed = ensureDescriptions(payload.data);
  if (descriptionsFixed > 0) {
    fs.writeFileSync(dataPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  const postings = buildPostings(payload.data);
  fs.mkdirSync(INDEX_DIRECTORY, { recursive: true });
  fs.writeFileSync(path.join(INDEX_DIRECTORY, index), `${JSON.stringify(postings)}\n`);

  console.log(
    `${file}: ${payload.data.length} records, ${Object.keys(postings).length} trigrams, ` +
    `${descriptionsFixed} descriptions added`
  );
}

DATASETS.forEach(buildDataset);
