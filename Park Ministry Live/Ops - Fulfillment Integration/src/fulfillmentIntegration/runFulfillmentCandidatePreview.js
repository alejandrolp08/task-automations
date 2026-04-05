const fs = require("fs/promises");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getFulfillmentIntegrationOperativePaths } = require("../../../Workspace/operativePaths");
const {
  fetchFulfillmentCandidates,
  verifyFulfillmentCandidatePdf,
} = require("./fetchFulfillmentCandidates");

loadEnv();

const PATHS = getFulfillmentIntegrationOperativePaths();

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function writePreviewResult(result) {
  await ensureDirectory(PATHS.outputs);
  const filePath = PATHS.latestJson.replace(/\.json$/, "-candidates.json");
  await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
}

async function runFulfillmentCandidatePreview() {
  const candidates = await fetchFulfillmentCandidates();
  const limit = Math.max(1, Number(process.env.FULFILLMENT_PREVIEW_LIMIT || 25));
  const previewCandidates = candidates.eligible_records.slice(0, limit);
  const verifiedPreview = [];

  for (const record of previewCandidates) {
    verifiedPreview.push({
      ...record,
      pdf_verification: await verifyFulfillmentCandidatePdf(record),
    });
  }

  const result = {
    run_type: "fulfillment_candidate_preview_v1",
    recorded_at: new Date().toISOString(),
    table_id: candidates.table_id,
    start_date: candidates.start_date,
    field_map: candidates.field_map,
    summary: {
      total_records: candidates.normalized_records.length,
      deduped_records: candidates.deduped_records.length,
      eligible_records: candidates.eligible_records.length,
      preview_limit: limit,
    },
    eligible_preview: verifiedPreview.map((record) => ({
      record_id: record.record_id,
      event_date: record.event_date,
      sold_status: record.sold_status,
      fulfilled_status: record.fulfilled_status,
      provider: record.provider,
      provider_name: record.provider_name,
      provider_key: record.provider_key,
      inferred_provider: record.inferred_provider,
      effective_provider: record.effective_provider,
      invoice_id: record.invoice_id,
      marketplace_sale_id: record.marketplace_sale_id,
      external_order_number: record.external_order_number,
      reservation_id: record.reservation_id,
      reservation_url: record.reservation_url,
      resolution_override: record.resolution_override,
      request_comment_detail: record.request_comment_detail,
      pdf_name: record.pdf_name,
      pdf_url_present: Boolean(record.pdf_url),
      pdf_handle_present: Boolean(record.pdf_handle),
      pdf_mime_type: record.pdf_mime_type,
      pdf_size: record.pdf_size,
      pdf_verification: record.pdf_verification,
      full_event_info: record.full_event_info,
    })),
  };

  result.output_file = await writePreviewResult(result);
  return result;
}

if (require.main === module) {
  runFulfillmentCandidatePreview()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("Fulfillment candidate preview failed.");
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runFulfillmentCandidatePreview,
};
