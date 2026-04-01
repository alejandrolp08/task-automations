const fs = require("fs/promises");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getBuyingBotOperativePaths } = require("../../../Workspace/operativePaths");
const { fetchBuying } = require("./fetchBuying");
const { normalizeBuyingRecords } = require("../../../Shared/src/shared/records/normalizeBuying");
const { filterBuying } = require("./filterBuying");
const { buildOutput } = require("./buildOutput");
const {
  buildProviderExecutionPlans,
  buildSharedExecutionStages,
} = require("./providerPlanning");
const { getActiveBuyingProviderKeys } = require("./config");

loadEnv();

async function askDateRange() {
  const rl = readline.createInterface({ input, output });

  try {
    const startDate = (await rl.question("Enter start_date (YYYY-MM-DD): ")).trim();
    const endDate = (await rl.question("Enter end_date (YYYY-MM-DD): ")).trim();

    return { startDate, endDate };
  } finally {
    rl.close();
  }
}

async function runBuyingBot() {
  const dataPath = getBuyingBotOperativePaths().data.sampleBuyingJson;
  const outputPath = getBuyingBotOperativePaths().resultJson;

  const { startDate, endDate } = await askDateRange();
  const { records: rawRecords, source } = await fetchBuying(dataPath, { startDate, endDate });
  const normalizedRecords = normalizeBuyingRecords(rawRecords);
  const activeProviderKeys = getActiveBuyingProviderKeys();
  const recordsToBuy = filterBuying(normalizedRecords, startDate, endDate, { activeProviderKeys });
  const sharedExecutionStages = await buildSharedExecutionStages(recordsToBuy);
  const providerExecutionPlans = buildProviderExecutionPlans(recordsToBuy);
  const result = buildOutput(
    startDate,
    endDate,
    recordsToBuy,
    source,
    sharedExecutionStages,
    providerExecutionPlans,
  );

  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`Generated ${outputPath}`);
  console.log(`Source: ${source}`);
  console.log(`Recommended purchases: ${recordsToBuy.length}`);
  console.log(`Active providers: ${activeProviderKeys.join(", ") || "none"}`);
  console.log(`Shared stages: ${sharedExecutionStages.map((stage) => stage.stage).join(", ") || "none"}`);
  console.log(`Providers in scope: ${providerExecutionPlans.map((plan) => plan.provider).join(", ") || "none"}`);
}

module.exports = { runBuyingBot };
