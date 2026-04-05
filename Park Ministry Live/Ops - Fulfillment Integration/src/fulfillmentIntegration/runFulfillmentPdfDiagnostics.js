const fs = require("fs/promises");
const path = require("path");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getFulfillmentIntegrationOperativePaths } = require("../../../Workspace/operativePaths");
const { fetchFulfillmentCandidates } = require("./fetchFulfillmentCandidates");
const { runFulfillmentPdfValidationPreview } = require("./runFulfillmentPdfValidationPreview");

loadEnv();

const PATHS = getFulfillmentIntegrationOperativePaths();

function parseList(rawValue) {
  return Array.from(
    new Set(
      String(rawValue || "")
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function getDefaultModes() {
  return process.platform === "darwin"
    ? ["auto", "swift", "portable", "direct"]
    : ["auto", "portable", "direct"];
}

async function writeDiagnosticsResult(result) {
  await fs.mkdir(PATHS.outputs, { recursive: true });
  const filePath = path.join(PATHS.outputs, "fulfillment-pdf-diagnostics-last-run.json");
  await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
}

function buildComparison(runs) {
  const bySale = new Map();

  for (const run of runs) {
    for (const validation of run.validations || []) {
      const saleId = String(validation.stubhub_sale || "").trim();
      if (!saleId) {
        continue;
      }

      if (!bySale.has(saleId)) {
        bySale.set(saleId, []);
      }

      bySale.get(saleId).push({
        ocr_mode: run.ocr_mode,
        status: validation.validation?.status || "review",
        score: validation.validation?.score ?? null,
        extraction_source: validation.extraction_source || "",
        provider: validation.effective_provider || validation.provider || "",
        issues: validation.validation?.issues || [],
      });
    }
  }

  return Array.from(bySale.entries())
    .map(([sale_id, results]) => ({ sale_id, results }))
    .sort((left, right) => left.sale_id.localeCompare(right.sale_id));
}

async function runFulfillmentPdfDiagnostics() {
  const saleIds = parseList(
    process.env.FULFILLMENT_DIAGNOSTIC_SALE_IDS || process.argv.slice(2).join(","),
  );

  if (saleIds.length === 0) {
    throw new Error("Missing diagnostic sale IDs. Set FULFILLMENT_DIAGNOSTIC_SALE_IDS or pass IDs as args.");
  }

  const requestedModes = parseList(process.env.FULFILLMENT_DIAGNOSTIC_OCR_MODES);
  const ocrModes = requestedModes.length > 0 ? requestedModes : getDefaultModes();
  const candidates = await fetchFulfillmentCandidates();
  const scopedCandidates = candidates.deduped_records.filter((candidate) =>
    saleIds.includes(String(candidate.marketplace_sale_id || "").trim()),
  );

  const candidateSnapshot = {
    ...candidates,
    deduped_records: scopedCandidates,
  };

  const runs = [];

  for (const ocrMode of ocrModes) {
    const result = await runFulfillmentPdfValidationPreview({
      candidates: candidateSnapshot,
      records: scopedCandidates,
      limit: scopedCandidates.length || saleIds.length,
      offset: 0,
      saleIds,
      ocrMode,
      includeNonEligible: true,
      skipWrite: true,
    });

    runs.push({
      ocr_mode: ocrMode,
      summary: result.summary,
      validations: result.validations,
      sale_groups: result.sale_groups,
    });
  }

  const result = {
    run_type: "fulfillment_pdf_diagnostics_v1",
    recorded_at: new Date().toISOString(),
    sale_ids: saleIds,
    ocr_modes: ocrModes,
    candidate_count: scopedCandidates.length,
    runs,
    comparison: buildComparison(runs),
  };

  result.output_file = await writeDiagnosticsResult(result);
  return result;
}

if (require.main === module) {
  runFulfillmentPdfDiagnostics()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("Fulfillment PDF diagnostics failed.");
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runFulfillmentPdfDiagnostics,
};
