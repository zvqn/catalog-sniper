const assert = require("node:assert/strict");
const test = require("node:test");

const { createHandler, normalizeSearchText } = require("../lib/catalog-api");
const emotesHandler = require("../api/emotes");
const animationHandler = require("../api/animation");
const moodsHandler = require("../api/moods");

function invoke(handler, url, method = "GET") {
  const response = {
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
  handler({ method, url }, response);
  return response;
}

function makeIndex(records) {
  const index = Object.create(null);
  records.forEach((record, ordinal) => {
    const searchable = normalizeSearchText(`${record.name} ${record.description}`);
    const characters = Array.from(searchable);
    const grams = new Set();
    for (let offset = 0; offset <= characters.length - 3; offset++) {
      grams.add(characters.slice(offset, offset + 3).join(""));
    }
    for (const gram of grams) {
      (index[gram] ||= []).push(ordinal);
    }
  });
  return index;
}

test("default pagination returns only the first 50 emotes", () => {
  const response = invoke(emotesHandler, "/api/emotes");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.length, 50);
  assert.deepEqual(response.body.pagination, {
    page: 1,
    limit: 50,
    total: 53285,
    hasMore: true
  });
  assert.equal(typeof response.body.data[0].description, "string");
});

test("pagination clamps the requested limit and returns the requested page", () => {
  const response = invoke(animationHandler, "/api/animation?page=2&limit=999");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.pagination.page, 2);
  assert.equal(response.body.pagination.limit, 200);
  assert.equal(response.body.data.length, 200);
  assert.equal(response.body.data[0].id, require("../public/v1/animationdata.json").data[200].id);
});

test("search is case-insensitive, whitespace-normalized, and handles punctuation", () => {
  const emotes = invoke(emotesHandler, "/api/emotes?limit=25&search=++SALUTE+++");
  assert.ok(emotes.body.pagination.total >= 1);
  assert.ok(emotes.body.data.some((record) => record.name === "Salute"));

  const moods = invoke(moodsHandler, "/api/moods?search=%20%3A-%2F%20");
  assert.ok(moods.body.pagination.total > 0);
  assert.ok(moods.body.data.some((record) => record.name.includes(":-/")));
});

test("cleared and unmatched searches return normal page data and an empty result respectively", () => {
  const unfiltered = invoke(moodsHandler, "/api/moods?search=%20%20");
  assert.equal(unfiltered.body.pagination.total, 94);
  assert.equal(unfiltered.body.data.length, 50);

  const missing = invoke(moodsHandler, "/api/moods?search=not-a-real-mood-xyz");
  assert.equal(missing.body.pagination.total, 0);
  assert.deepEqual(missing.body.data, []);
  assert.equal(missing.body.pagination.hasMore, false);
});

test("search matches source descriptions without requiring invented metadata", () => {
  const records = [
    { id: 1, name: "Gentle Look", description: "Calm, peaceful face." },
    { id: 2, name: "Bright Smile", description: "" }
  ];
  const handler = createHandler("description-fixture", records, makeIndex(records));
  const response = invoke(handler, "/api/fixture?search=PEACEFUL%20FACE");
  assert.equal(response.body.pagination.total, 1);
  assert.equal(response.body.data[0].id, 1);
});

test("non-GET methods are rejected and OPTIONS is supported", () => {
  const methodResponse = invoke(moodsHandler, "/api/moods", "POST");
  assert.equal(methodResponse.statusCode, 405);
  assert.deepEqual(methodResponse.body, { error: "Method not allowed" });

  const optionsResponse = invoke(moodsHandler, "/api/moods", "OPTIONS");
  assert.equal(optionsResponse.statusCode, 204);
  assert.equal(optionsResponse.ended, true);
});
