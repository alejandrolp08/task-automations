const fs = require("fs/promises");
const path = require("path");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getSalesTrackingOperativePaths } = require("../../../Workspace/operativePaths");
const { applySaleToSmartSuite, buildSaleUpdateItems } = require("./applySaleToSmartSuite");
const { fetchSalesTrackingCandidates } = require("./fetchSalesTrackingCandidates");
const { parseViagogoSaleEmail } = require("./parseViagogoSaleEmail");
const { selectSaleCandidates } = require("./selectSaleCandidates");

loadEnv();

const PATHS = getSalesTrackingOperativePaths();

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function readEmailInput() {
  const filePath = process.argv[2] || process.env.SALES_TRACKING_EMAIL_FILE;

  if (!filePath) {
    throw new Error(
      "Missing email input. Pass a file path as the first argument or set SALES_TRACKING_EMAIL_FILE.",
    );
  }

  return fs.readFile(path.resolve(filePath), "utf8");
}

async function writeLatestResult(result) {
  await ensureDirectory(PATHS.outputs);
  await fs.writeFile(PATHS.latestJson, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function runSalesTracking() {
  const parsedSale = parseViagogoSaleEmail(await readEmailInput());

  if (!parsedSale.success) {
    const parseFailure = {
      run_type: "sales_tracking_v1",
      status: "parse_failed",
      parsed_sale: parsedSale,
    };
    await writeLatestResult(parseFailure);
    return parseFailure;
  }

  const candidates = await fetchSalesTrackingCandidates({ eventDate: parsedSale.event_date });
  const selection = selectSaleCandidates(parsedSale, candidates.eligible_records);
  const dryRun = process.env.SALES_TRACKING_APPLY === "1" ? false : true;

  const result = {
    run_type: "sales_tracking_v1",
    status: selection.matched ? (dryRun ? "matched_dry_run" : "matched_applied") : "review",
    dry_run: dryRun,
    parsed_sale: selection.sale,
    summary: {
      total_records_on_event_date: candidates.normalized_records.length,
      eligible_unsold_records: candidates.eligible_records.length,
      candidate_pool_size: selection.candidate_pool.length,
      qty_requested: selection.qty_requested,
      qty_selected: selection.qty_selected,
    },
    selected_candidates: selection.selected_candidates,
    candidate_pool: selection.candidate_pool,
    review_reason: selection.review_reason,
  };

  if (selection.matched) {
    result.planned_updates = buildSaleUpdateItems(selection);

    if (!dryRun) {
      result.smartsuite_update = await applySaleToSmartSuite(selection);
    }
  }

  await writeLatestResult(result);
  return result;
}

if (require.main === module) {
  runSalesTracking()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("Sales tracking run failed.");
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runSalesTracking,
};
