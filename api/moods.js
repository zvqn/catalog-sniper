const { createHandler } = require("../lib/catalog-api");
const records = require("../public/v1/mooddata.json").data;
const index = require("../generated/search-indexes/moods-search.json");

module.exports = createHandler("moods", records, index);
