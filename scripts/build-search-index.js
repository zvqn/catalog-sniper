const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const indexDirectory = path.join(projectRoot, "generated", "search-indexes");
const datasets = [
  { file: "emotedata.json", index: "emotes-search.json" },
  { file: "animationdata.json", index: "animation-search.json" },
  { file: "mooddata.json", index: "moods-search.json" }
];

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function trigrams(value) {
  const characters = Array.from(value);
  const result = new Set();
  for (let offset = 0; offset <= characters.length - 3; offset++) {
    result.add(characters.slice(offset, offset + 3).join(""));
  }
  return result;
}

for (const dataset of datasets) {
  const dataPath = path.join(projectRoot, "public", "v1", dataset.file);
  const payload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  if (!Array.isArray(payload.data)) {
    throw new Error(`${dataPath} must contain a data array`);
  }

  let descriptionsAdded = 0;
  for (const record of payload.data) {
    if (typeof record.description !== "string") {
      record.description = "";
      descriptionsAdded++;
    }
  }
  if (descriptionsAdded > 0) {
    fs.writeFileSync(dataPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  const postings = Object.create(null);
  payload.data.forEach((record, ordinal) => {
    const searchable = normalizeSearchText(`${record.name || ""} ${record.description || ""}`);
    for (const gram of trigrams(searchable)) {
      (postings[gram] ||= []).push(ordinal);
    }
  });

  const indexPath = path.join(indexDirectory, dataset.index);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(postings)}\n`);
  console.log(
    `${dataset.file}: ${payload.data.length} records, ${Object.keys(postings).length} trigrams, ` +
    `${descriptionsAdded} descriptions normalized`
  );
}

