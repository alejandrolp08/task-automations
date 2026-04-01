const fs = require("fs/promises");
const path = require("path");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getFulfillmentIntegrationOperativePaths } = require("../../../Workspace/operativePaths");
const {
  fetchFulfillmentCandidates,
  verifyFulfillmentCandidatePdf,
} = require("./fetchFulfillmentCandidates");
const {
  extractPdfTextWithFallback,
  validatePdfAgainstRecord,
} = require("./validateFulfillmentPdf");
const {
  buildStubhubHeaders,
  buildStubhubInvoiceAssetsUrl,
  buildStubhubInvoiceByMarketplaceSaleUrl,
} = require("./stubhubFulfillmentApi");

loadEnv();

const PATHS = getFulfillmentIntegrationOperativePaths();

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PDF download failed (${response.status}): ${errorText}`);
  }

  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
  return targetPath;
}

async function writeValidationResult(result) {
  await ensureDirectory(PATHS.outputs);
  const filePath = PATHS.latestJson.replace(/\.json$/, "-pdf-validation.json");
  await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
}

async function stubhubRequest(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  let body = null;

  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
  }

  if (!response.ok) {
    throw new Error(
      `StubHub POS API ${response.status}: ${
        body && typeof body === "object" ? JSON.stringify(body) : bodyText || response.statusText
      }`,
    );
  }

  return body;
}

function getValidationContext() {
  return {
    includeStubhubPrecheck: process.env.FULFILLMENT_INCLUDE_STUBHUB_PRECHECK === "1",
    stubhubToken: String(process.env.STUBHUB_POS_API_TOKEN || "").trim(),
    stubhubAccountId: String(process.env.STUBHUB_POS_ACCOUNT_ID || "").trim(),
  };
}

async function getStubhubSalePrecheck(marketplaceSaleId, context) {
  if (!context.includeStubhubPrecheck) {
    return null;
  }

  if (!context.stubhubToken || !context.stubhubAccountId || !marketplaceSaleId) {
    return {
      ok: false,
      skipped: true,
      reason: "missing_stubhub_credentials_or_sale_id",
    };
  }

  try {
    const headers = buildStubhubHeaders({
      token: context.stubhubToken,
      accountId: context.stubhubAccountId,
      contentType: "application/json",
    });
    const invoice = await stubhubRequest(
      buildStubhubInvoiceByMarketplaceSaleUrl(marketplaceSaleId, "StubHub"),
      { method: "GET", headers },
    );
    const invoiceId = String(invoice?.id || "").trim();
    const assets = invoiceId
      ? await stubhubRequest(buildStubhubInvoiceAssetsUrl(invoiceId), { method: "GET", headers })
      : null;
    const tickets = Array.isArray(assets?.tickets) ? assets.tickets : [];
    const ticketsCount = tickets.length;
    const transferDocsCount = Array.isArray(assets?.transferDocs) ? assets.transferDocs.length : 0;
    const transferUrlsCount = Array.isArray(assets?.transferUrls) ? assets.transferUrls.length : 0;
    const hasShipment = Boolean(assets?.shipment);
    const uploadedTicketCount = tickets.filter(
      (ticket) => ticket?.eTicket || ticket?.ticketUrl || ticket?.barcode,
    ).length;
    const availableTicketIds = tickets
      .map((ticket) => ticket?.id)
      .filter((ticketId) => Number.isFinite(Number(ticketId)))
      .map((ticketId) => Number(ticketId));
    const hasUploadedAssets =
      uploadedTicketCount > 0 || transferDocsCount > 0 || transferUrlsCount > 0 || hasShipment;

    return {
      ok: true,
      skipped: false,
      invoice_id: invoiceId,
      fulfillment_date: invoice?.fulfillmentDate || null,
      pos_fulfillment_state: String(invoice?.posState?.fullfilmentState || "").trim(),
      allocation_state: String(invoice?.posState?.allocationState || "").trim(),
      sale_status: String(invoice?.posState?.saleStatus || "").trim(),
      has_assets: hasUploadedAssets,
      assets_count: uploadedTicketCount + transferDocsCount + transferUrlsCount + (hasShipment ? 1 : 0),
      available_ticket_ids: availableTicketIds,
      assets_summary: {
        tickets_count: ticketsCount,
        uploaded_tickets_count: uploadedTicketCount,
        transfer_docs_count: transferDocsCount,
        transfer_urls_count: transferUrlsCount,
        has_shipment: hasShipment,
      },
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: "stubhub_precheck_failed",
      error: error.message,
    };
  }
}

function summarizeSaleValidation(groupItems) {
  const statuses = groupItems.map((item) => item.validation?.status || "review");

  if (statuses.includes("fail_date_mismatch")) {
    return "fail_date_mismatch";
  }

  if (statuses.includes("review_location_mismatch")) {
    return "review_location_mismatch";
  }

  if (statuses.includes("review_provider_exception") || statuses.includes("review")) {
    return "review_provider_exception";
  }

  if (statuses.every((status) => status === "pass_provider_exception")) {
    return "pass_provider_exception";
  }

  if (
    statuses.every((status) =>
      ["pass_auto", "pass_provider_exception"].includes(status),
    )
  ) {
    return statuses.includes("pass_provider_exception") ? "pass_provider_exception" : "pass_auto";
  }

  return "review";
}

function normalizeGroupText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildSaleGroupKey(item) {
  const saleId = String(item.stubhub_sale || item.record_id || "").trim();
  const eventDate = String(item.event_date || "").trim();
  const parkingLocation = normalizeGroupText(
    item.validation?.checks?.parking_location?.expected || item.parking_location || "",
  );

  return [saleId, eventDate, parkingLocation].join("::");
}

async function buildSaleGroups(validations, context) {
  const grouped = new Map();

  for (const item of validations) {
    const key = buildSaleGroupKey(item);

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(item);
  }

  const groups = [];

  for (const [saleId, items] of grouped.entries()) {
    const firstItem = items[0] || {};
    const stubhubSale = String(firstItem.stubhub_sale || "").trim();
    const saleStatus = summarizeSaleValidation(items);
    const stubhubPrecheck = await getStubhubSalePrecheck(stubhubSale, context);

    groups.push({
      group_key: saleId,
      stubhub_sale: stubhubSale,
      sale_status: saleStatus,
      event_dates: Array.from(new Set(items.map((item) => item.event_date).filter(Boolean))),
      parking_locations: Array.from(
        new Set(
          items
            .map((item) => item.validation?.checks?.parking_location?.expected || item.parking_location)
            .filter(Boolean),
        ),
      ),
      records: items.map((item) => ({
        record_id: item.record_id,
        pdf_name: item.pdf_name,
        validation_status: item.validation?.status || "review",
      })),
      stubhub_precheck: stubhubPrecheck,
    });
  }

  return groups.sort((a, b) => String(a.group_key).localeCompare(String(b.group_key)));
}

async function runFulfillmentPdfValidationPreview() {
  const limit = Math.max(1, Number(process.env.FULFILLMENT_PREVIEW_LIMIT || 5));
  const offset = Math.max(0, Number(process.env.FULFILLMENT_PREVIEW_OFFSET || 0));
  const context = getValidationContext();
  const candidates = await fetchFulfillmentCandidates();
  const previewCandidates = candidates.eligible_records.slice(offset, offset + limit);
  const downloadsDir = path.join(PATHS.outputs, "downloads");
  const validations = [];

  for (const candidate of previewCandidates) {
    const pdfVerification = await verifyFulfillmentCandidatePdf(candidate);

    if (!pdfVerification.verified || !pdfVerification.shared_file_url) {
    validations.push({
      stubhub_sale: candidate.marketplace_sale_id,
      record_id: candidate.record_id,
      event_date: candidate.event_date,
      parking_location: candidate.full_event_info,
      reservation_id: candidate.reservation_id,
      pdf_name: candidate.pdf_name,
      verification: pdfVerification,
        validation: {
          ok: false,
          status: "review",
          classification: "review",
          issues: ["pdf_not_downloadable"],
        },
      });
      continue;
    }

    const safeFileName =
      candidate.pdf_name ||
      `${candidate.marketplace_sale_id || candidate.record_id || "candidate"}.pdf`;
    const targetPath = path.join(downloadsDir, safeFileName.replace(/[^\w.-]+/g, "_"));
    await downloadFile(pdfVerification.shared_file_url, targetPath);
    const pdfText = await extractPdfTextWithFallback(targetPath);
    const validation = validatePdfAgainstRecord(candidate, pdfText);

    validations.push({
      stubhub_sale: candidate.marketplace_sale_id,
      record_id: candidate.record_id,
      event_date: candidate.event_date,
      parking_location: candidate.full_event_info,
      reservation_id: candidate.reservation_id,
      pdf_name: candidate.pdf_name,
      file_path: targetPath,
      extraction_source: pdfText.source || "direct_text",
      verification: pdfVerification,
      validation,
    });
  }

  const sale_groups = await buildSaleGroups(validations, context);

  const result = {
    run_type: "fulfillment_pdf_validation_preview_v1",
    recorded_at: new Date().toISOString(),
    start_date: candidates.start_date,
    preview_offset: offset,
    summary: {
      total_eligible_records: candidates.eligible_records.length,
      validated_records: validations.length,
      passed: validations.filter((item) => item.validation?.ok).length,
      review: validations.filter((item) =>
        String(item.validation?.status || "").startsWith("review"),
      ).length,
      pass_auto: validations.filter((item) => item.validation?.status === "pass_auto").length,
      pass_provider_exception: validations.filter(
        (item) => item.validation?.status === "pass_provider_exception",
      ).length,
      review_provider_exception: validations.filter(
        (item) => item.validation?.status === "review_provider_exception",
      ).length,
      review_location_mismatch: validations.filter(
        (item) => item.validation?.status === "review_location_mismatch",
      ).length,
      fail_date_mismatch: validations.filter(
        (item) => item.validation?.status === "fail_date_mismatch",
      ).length,
    },
    validations,
    sale_groups,
  };

  result.output_file = await writeValidationResult(result);
  return result;
}

if (require.main === module) {
  runFulfillmentPdfValidationPreview()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("Fulfillment PDF validation preview failed.");
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runFulfillmentPdfValidationPreview,
};
