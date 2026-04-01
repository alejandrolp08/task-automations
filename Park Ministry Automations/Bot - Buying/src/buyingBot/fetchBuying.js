const fs = require("fs/promises");
const path = require("path");

const { fetchSmartsuiteBuying } = require("./fetchSmartsuiteBuying");

async function fetchBuyingFromFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("sampleBuying.json must contain an array of records.");
  }

  return parsed;
}

function shouldUseSmartsuite() {
  if (process.env.BUYING_SOURCE === "local") {
    return false;
  }

  if (process.env.BUYING_SOURCE === "smartsuite") {
    return true;
  }

  return Boolean(process.env.SMARTSUITE_API_TOKEN);
}

async function fetchBuying(filePath, options = {}) {
  if (shouldUseSmartsuite()) {
    const records = await fetchSmartsuiteBuying(options);
    return {
      records,
      source: "smartsuite",
    };
  }

  const records = await fetchBuyingFromFile(filePath);
  return {
    records,
    source: "local_sample",
  };
}

module.exports = { fetchBuying, fetchBuyingFromFile, shouldUseSmartsuite };
