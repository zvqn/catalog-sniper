const { createHandler } = require("../lib/catalog-api");
const records = require("../public/v1/emotedata.json").data;
const index = require("../generated/search-indexes/emotes-search.json");

module.exports = createHandler("emotes", records, index);
