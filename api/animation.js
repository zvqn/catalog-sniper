const { createHandler } = require("../lib/catalog-api");
const records = require("../public/v1/animationdata.json").data;
const index = require("../generated/search-indexes/animation-search.json");

module.exports = createHandler("animation", records, index);
