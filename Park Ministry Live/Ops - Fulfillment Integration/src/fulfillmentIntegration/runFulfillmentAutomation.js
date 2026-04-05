const fs = require("fs/promises");
const path = require("path");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getFulfillmentIntegrationOperativePaths } = require("../../../Workspace/operativePaths");
const { fetchFulfillmentCandidates } = require("./fetchFulfillmentCandidates");
const { runFulfillmentPdfValidationPreview } = require("./runFulfillmentPdfValidationPreview");
const { runFulfillmentIntegration } = require("./runFulfillmentIntegration");
const {
  AUTOMATION_NOTE_MESSAGES,
} = require("./fulfillmentAutomationNotes");
const {
  appendFulfillmentAutomationComment,
  markFulfillmentRecordFulfilled,
} = require("./updateSmartsuiteFulfillmentStatus");

loadEnv();

const PATHS = getFulfillmentIntegrationOperativePaths();

function isPassStatus(status) {
  return status === "pass_auto" || status === "pass_provider_exception";
}

function getValidationNote(validationStatus) {
  if (validationStatus === "fail_date_mismatch") {
    return AUTOMATION_NOTE_MESSAGES.eventDateMismatch;
  }

  if (validationStatus === "review_location_mismatch") {
    return AUTOMATION_NOTE_MESSAGES.locationMismatch;
  }

  if (validationStatus === "review_provider_exception" || validationStatus === "review" || validationStatus === "fail") {
    return AUTOMATION_NOTE_MESSAGES.validationFailed;
  }

  return "";
}

function sendResultShowsDeliveredAssets(sendResult) {
  const assets = sendResult?.assets_response || {};
  const tickets = Array.isArray(assets?.tickets) ? assets.tickets : [];
  const uploadedTicketCount = tickets.filter(
    (ticket) => ticket?.eTicket || ticket?.ticketUrl || ticket?.barcode,
  ).length;
  const transferDocsCount = Array.isArray(assets?.transferDocs) ? assets.transferDocs.length : 0;
  const transferUrlsCount = Array.isArray(assets?.transferUrls) ? assets.transferUrls.length : 0;
  const hasShipment = Boolean(assets?.shipment);
  const posFulfillmentState = String(sendResult?.patch_response?.posState?.fullfilmentState || "").toLowerCase();

  return (
    uploadedTicketCount > 0 ||
    transferDocsCount > 0 ||
    transferUrlsCount > 0 ||
    hasShipment ||
    posFulfillmentState === "fulfilled"
  );
}

function summarizeDeliveredAssets(sendResult) {
  const assets = sendResult?.assets_response || {};
  const tickets = Array.isArray(assets?.tickets) ? assets.tickets : [];
  const uploadedTicketCount = tickets.filter(
    (ticket) => ticket?.eTicket || ticket?.ticketUrl || ticket?.barcode,
  ).length;
  const transferDocsCount = Array.isArray(assets?.transferDocs) ? assets.transferDocs.length : 0;
  const transferUrlsCount = Array.isArray(assets?.transferUrls) ? assets.transferUrls.length : 0;
  const hasShipment = Boolean(assets?.shipment);

  return {
    uploaded_tickets_count: uploadedTicketCount,
    transfer_docs_count: transferDocsCount,
    transfer_urls_count: transferUrlsCount,
    has_shipment: hasShipment,
    pos_fulfillment_state: String(sendResult?.patch_response?.posState?.fullfilmentState || ""),
    sale_status: String(sendResult?.patch_response?.posState?.saleStatus || ""),
  };
}

function sanitizeSendResultForOutput(sendResult) {
  if (!sendResult || typeof sendResult !== "object") {
    return sendResult;
  }

  return {
    ok: Boolean(sendResult.ok),
    provider: sendResult.provider || "",
    status: sendResult.status || "",
    dry_run: Boolean(sendResult.dry_run),
    invoice_id: sendResult.invoice_id || "",
    marketplace_sale_id: sendResult.marketplace_sale_id || "",
    marketplace: sendResult.marketplace || "",
    patch_status_code: sendResult.patch_status_code || null,
    invoice_summary: sendResult.invoice_summary || null,
    request_preview: sendResult.request_preview || null,
    endpoints: sendResult.endpoints || null,
    delivered_assets_summary: summarizeDeliveredAssets(sendResult),
  };
}

function buildPendingAllocationSupportNote(precheck, stubhubSale) {
  const invoiceId = String(precheck?.invoice_id || "").trim();
  const saleStatus = String(precheck?.sale_status || "").trim() || "Unknown";
  const allocationState = String(precheck?.allocation_state || "").trim() || "Unknown";
  const availableTicketIds = Array.isArray(precheck?.available_ticket_ids)
    ? precheck.available_ticket_ids
    : [];

  return [
    "We are testing an automation that uploads PDF parking passes directly to StubHub POS.",
    `Sale #: ${stubhubSale || "Unknown"}.`,
    `Invoice ID: ${invoiceId || "Unknown"}.`,
    `POS saleStatus: ${saleStatus}.`,
    `POS allocationState: ${allocationState}.`,
    `Available ticketIds returned by API: ${availableTicketIds.length ? availableTicketIds.join(", ") : "none"}.`,
    "For some pre-migration / allocation-required sales, the POS API rejects fulfillment because it requires ticketId.",
    "How should we upload PDFs for these sales when the API does not return usable ticketIds, but the StubHub web flow still allows manual handling?",
  ].join(" ");
}

function buildExecutiveSummary(actions = []) {
  const categories = new Map();
  const categoryMap = {
    sent_and_marked_fulfilled: "Fulfilled",
    would_send_and_mark_fulfilled: "Fulfilled",
    marked_fulfilled_from_stubhub_precheck: "Fulfilled from StubHub precheck",
    would_mark_fulfilled_from_stubhub_precheck: "Fulfilled from StubHub precheck",
    stubhub_send_blocked_missing_ticket_ids: "Blocked missing ticket IDs",
    would_comment_missing_ticket_ids: "Blocked missing ticket IDs",
    commented_review_records: "Commented review records",
    would_comment_review_records: "Commented review records",
    send_failed_and_commented: "Send failed",
    would_comment_send_failed: "Send failed",
    send_returned_without_uploaded_assets: "Send returned without uploaded assets",
    would_comment_send_returned_without_uploaded_assets: "Send returned without uploaded assets",
    stubhub_precheck_failed: "StubHub precheck failed",
    stubhub_precheck_skipped: "StubHub precheck skipped",
  };

  function getBucket(label) {
    if (!categories.has(label)) {
      categories.set(label, {
        label,
        count: 0,
        sales: [],
        comments: new Set(),
      });
    }

    return categories.get(label);
  }

  for (const action of actions) {
    const actionName = String(action?.action || "");
    const label = categoryMap[actionName];
    if (!label) {
      continue;
    }

    const bucket = getBucket(label);
    bucket.count += 1;

    const sale = String(action?.stubhub_sale || "").trim();
    if (sale) {
      bucket.sales.push(sale);
    }

    for (const update of action.smartsuite_updates || []) {
      const comment = String(update?.comment || update?.note || "").trim();
      if (!comment) {
        continue;
      }
      bucket.comments.add(comment);
    }
  }

  return {
    categories: Array.from(categories.values()).map((bucket) => ({
      label: bucket.label,
      count: bucket.count,
      sales: bucket.sales,
      comments: Array.from(bucket.comments).sort((a, b) => a.localeCompare(b)),
    })),
  };
}

function printExecutiveSummary(result) {
  const executive = result?.summary?.executive || buildExecutiveSummary(result?.actions || []);
  const categories = Array.isArray(executive?.categories) ? executive.categories : [];
  const lines = ["", "RUN SUMMARY"];

  for (const category of categories) {
    if (!category?.count) {
      continue;
    }

    const parts = [`- ${category.label}: ${category.count}`];

    if (Array.isArray(category.sales) && category.sales.length > 0) {
      parts.push(`Sales: ${category.sales.join(", ")}`);
    }

    if (Array.isArray(category.comments) && category.comments.length > 0) {
      const label = category.comments.length === 1 ? "Comment" : "Comments";
      parts.push(`${label}: ${category.comments.join("; ")}`);
    }

    lines.push(parts.join(" | "));
  }

  console.log(lines.join("\n"));
}

function isRetryableSendError(error) {
  const status = Number(error?.status || 0);
  if (status >= 500) {
    return true;
  }

  return /StubHub POS API 5\d\d:/i.test(String(error?.message || ""));
}

async function writeAutomationResult(result) {
  await fs.mkdir(PATHS.outputs, { recursive: true });
  const filePath = path.join(PATHS.outputs, "fulfillment-automation-last-run.json");
  await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
}

async function markRecordsFulfilled(recordIds, apply) {
  const updates = [];

  for (const recordId of recordIds) {
    if (!apply) {
      updates.push({
        record_id: recordId,
        status: "would_mark_fulfilled",
      });
      continue;
    }

    updates.push(await markFulfillmentRecordFulfilled(recordId));
  }

  return updates;
}

async function appendCommentToRecords(records, note, apply) {
  const updates = [];

  for (const record of records) {
    if (!note) {
      continue;
    }

    if (!apply) {
      updates.push({
        record_id: record.record_id,
        status: "would_append_comment",
        note,
      });
      continue;
    }

    updates.push(
      await appendFulfillmentAutomationComment(
        record.record_id,
        record.request_comment_detail,
        note,
      ),
    );
  }

  return updates;
}

function buildSaleValidationIndex(validationResult, candidateIndex) {
  const byGroupKey = new Map();

  for (const group of validationResult.sale_groups || []) {
    const records = group.records.map((groupRecord) => {
      const matchingValidation = (validationResult.validations || []).find(
        (item) => item.record_id === groupRecord.record_id,
      );
      const candidate = candidateIndex.get(groupRecord.record_id) || {};

      return {
        ...groupRecord,
        validation: matchingValidation?.validation || null,
        request_comment_detail: candidate.request_comment_detail || "",
      };
    });

    byGroupKey.set(group.group_key, {
      ...group,
      records,
    });
  }

  return byGroupKey;
}

async function runFulfillmentAutomation() {
  const apply = process.env.FULFILLMENT_AUTOMATION_APPLY === "1";
  const automationLimit = Math.max(1, Number(process.env.FULFILLMENT_AUTOMATION_LIMIT || 50));
  const automationOffset = Math.max(0, Number(process.env.FULFILLMENT_AUTOMATION_OFFSET || 0));
  const previousPrecheck = process.env.FULFILLMENT_INCLUDE_STUBHUB_PRECHECK;
  const previousIntegrationApply = process.env.FULFILLMENT_INTEGRATION_APPLY;
  const previousPreviewLimit = process.env.FULFILLMENT_PREVIEW_LIMIT;
  const previousPreviewOffset = process.env.FULFILLMENT_PREVIEW_OFFSET;
  process.env.FULFILLMENT_INCLUDE_STUBHUB_PRECHECK = "1";
  process.env.FULFILLMENT_INTEGRATION_APPLY = apply ? "1" : "0";

  try {
    const candidates = await fetchFulfillmentCandidates();
    const scopedEligibleRecords = candidates.eligible_records.slice(
      automationOffset,
      automationOffset + automationLimit,
    );
    process.env.FULFILLMENT_PREVIEW_LIMIT = String(scopedEligibleRecords.length || 0);
    process.env.FULFILLMENT_PREVIEW_OFFSET = String(automationOffset);
    const candidateIndex = new Map(
      scopedEligibleRecords.map((record) => [record.record_id, record]),
    );
    const validationResult = await runFulfillmentPdfValidationPreview({
      candidates,
    });
    const groups = buildSaleValidationIndex(validationResult, candidateIndex);
    const actions = [];

    for (const group of groups.values()) {
      const passRecords = group.records.filter((record) => isPassStatus(record.validation_status));
      const reviewRecords = group.records.filter((record) => !isPassStatus(record.validation_status));
      const recordIds = group.records.map((record) => record.record_id).filter(Boolean);
      const precheck = group.stubhub_precheck || null;
      const posFulfillmentState = String(precheck?.pos_fulfillment_state || "").toLowerCase();
      const alreadyFulfilledExternally = Boolean(
        precheck && precheck.ok && (precheck.has_assets || posFulfillmentState === "fulfilled"),
      );

      if (alreadyFulfilledExternally) {
        const fulfilledUpdates = await markRecordsFulfilled(recordIds, apply);
        actions.push({
          group_key: group.group_key,
          stubhub_sale: group.stubhub_sale,
          action: apply ? "marked_fulfilled_from_stubhub_precheck" : "would_mark_fulfilled_from_stubhub_precheck",
          smartsuite_updates: fulfilledUpdates,
        });
        continue;
      }

      if (reviewRecords.length > 0) {
        const commentUpdates = [];

        for (const record of reviewRecords) {
          const note = getValidationNote(record.validation_status);
          const updates = await appendCommentToRecords([record], note, apply);
          commentUpdates.push(...updates);
        }

        actions.push({
          group_key: group.group_key,
          stubhub_sale: group.stubhub_sale,
          action: apply ? "commented_review_records" : "would_comment_review_records",
          smartsuite_updates: commentUpdates,
        });
        continue;
      }

      if (!precheck || precheck.skipped) {
        actions.push({
          group_key: group.group_key,
          stubhub_sale: group.stubhub_sale,
          action: "stubhub_precheck_skipped",
          reason: precheck?.reason || "missing_stubhub_credentials_or_sale_id",
        });
        continue;
      }

      if (!precheck.ok) {
        const commentUpdates = await appendCommentToRecords(
          passRecords,
          AUTOMATION_NOTE_MESSAGES.stubhubPrecheckFailed,
          apply,
        );
        actions.push({
          group_key: group.group_key,
          stubhub_sale: group.stubhub_sale,
          action: "stubhub_precheck_failed",
          reason: precheck.reason || "stubhub_precheck_failed",
          error: precheck.error || "",
          smartsuite_updates: commentUpdates,
        });
        continue;
      }

      const saleStatus = String(precheck?.sale_status || "").toLowerCase();
      const availableTicketIds = Array.isArray(precheck?.available_ticket_ids)
        ? precheck.available_ticket_ids
        : [];

      if (availableTicketIds.length === 0) {
        const commentUpdates = await appendCommentToRecords(
          passRecords,
          AUTOMATION_NOTE_MESSAGES.tvSaleCannotAutoFulfill,
          apply,
        );
        actions.push({
          group_key: group.group_key,
          stubhub_sale: group.stubhub_sale,
          action: apply
            ? "stubhub_send_blocked_missing_ticket_ids"
            : "would_comment_missing_ticket_ids",
          reason: "missing_ticket_ids",
          stubhub_precheck: {
            invoice_id: precheck.invoice_id || "",
            pos_fulfillment_state: precheck.pos_fulfillment_state || "",
            allocation_state: precheck.allocation_state || "",
            sale_status: precheck.sale_status || "",
            has_assets: Boolean(precheck.has_assets),
            available_ticket_ids: availableTicketIds,
            assets_summary: precheck.assets_summary || null,
          },
          support_note: buildPendingAllocationSupportNote(precheck, group.stubhub_sale),
          smartsuite_updates: commentUpdates,
        });
        continue;
      }

      const sendInput = {
        provider: "stubhub",
        marketplaceSaleId: group.stubhub_sale,
        marketplace: "StubHub",
        internalNotes: "Park Ministry auto-fulfillment",
        autoFulfill: true,
        pdfEntries: (validationResult.validations || [])
          .filter(
            (item) =>
              item.stubhub_sale === group.stubhub_sale &&
              recordIds.includes(item.record_id) &&
              item.file_path &&
              isPassStatus(item.validation?.status),
          )
          .map((item) => ({
            pdfPath: item.file_path,
            pdfName: item.pdf_name,
            ticketIds: precheck?.available_ticket_ids || [],
          })),
      };

      try {
        const sendResult = await runFulfillmentIntegration(sendInput);
        const delivered = sendResultShowsDeliveredAssets(sendResult);
        const fulfilledUpdates = delivered
          ? await markRecordsFulfilled(recordIds, apply)
          : await appendCommentToRecords(
              passRecords,
              AUTOMATION_NOTE_MESSAGES.sendFailed,
              apply,
            );
        actions.push({
          group_key: group.group_key,
          stubhub_sale: group.stubhub_sale,
          action: delivered
            ? apply
              ? "sent_and_marked_fulfilled"
              : "would_send_and_mark_fulfilled"
            : apply
              ? "send_returned_without_uploaded_assets"
              : "would_comment_send_returned_without_uploaded_assets",
          send_result: sanitizeSendResultForOutput(sendResult),
          smartsuite_updates: fulfilledUpdates,
        });
      } catch (error) {
        if (isRetryableSendError(error)) {
          actions.push({
            group_key: group.group_key,
            stubhub_sale: group.stubhub_sale,
            action: "send_failed_retryable",
            error: error.message,
            retryable: true,
            error_status: Number(error.status || 0) || null,
            error_attempts: Number(error.attempts || 0) || null,
            request_preview: {
              provider: sendInput.provider,
              marketplace_sale_id: sendInput.marketplaceSaleId,
              pdf_entries_count: Array.isArray(sendInput.pdfEntries) ? sendInput.pdfEntries.length : 0,
              ticket_ids_count: Array.isArray(precheck?.available_ticket_ids) ? precheck.available_ticket_ids.length : 0,
            },
            stubhub_precheck: {
              invoice_id: precheck.invoice_id || "",
              pos_fulfillment_state: precheck.pos_fulfillment_state || "",
              allocation_state: precheck.allocation_state || "",
              sale_status: precheck.sale_status || "",
              available_ticket_ids: Array.isArray(precheck.available_ticket_ids)
                ? precheck.available_ticket_ids
                : [],
            },
            smartsuite_updates: [],
          });
        } else {
          const commentUpdates = await appendCommentToRecords(
            passRecords,
            AUTOMATION_NOTE_MESSAGES.sendFailed,
            apply,
          );
          actions.push({
            group_key: group.group_key,
            stubhub_sale: group.stubhub_sale,
            action: apply ? "send_failed_and_commented" : "would_comment_send_failed",
            error: error.message,
            smartsuite_updates: commentUpdates,
          });
        }
      }
    }

    const executiveSummary = buildExecutiveSummary(actions);
    const result = {
      run_type: "fulfillment_automation_v1",
      recorded_at: new Date().toISOString(),
      apply,
      summary: {
        total_eligible_records: candidates.eligible_records.length,
        scoped_eligible_records: scopedEligibleRecords.length,
        validated_groups: groups.size,
        actions_count: actions.length,
        executive: executiveSummary,
      },
      validation_output_file: validationResult.output_file,
      actions,
    };
    result.output_file = await writeAutomationResult(result);
    return result;
  } finally {
    if (previousPrecheck == null) {
      delete process.env.FULFILLMENT_INCLUDE_STUBHUB_PRECHECK;
    } else {
      process.env.FULFILLMENT_INCLUDE_STUBHUB_PRECHECK = previousPrecheck;
    }

    if (previousIntegrationApply == null) {
      delete process.env.FULFILLMENT_INTEGRATION_APPLY;
    } else {
      process.env.FULFILLMENT_INTEGRATION_APPLY = previousIntegrationApply;
    }

    if (previousPreviewLimit == null) {
      delete process.env.FULFILLMENT_PREVIEW_LIMIT;
    } else {
      process.env.FULFILLMENT_PREVIEW_LIMIT = previousPreviewLimit;
    }

    if (previousPreviewOffset == null) {
      delete process.env.FULFILLMENT_PREVIEW_OFFSET;
    } else {
      process.env.FULFILLMENT_PREVIEW_OFFSET = previousPreviewOffset;
    }
  }
}

if (require.main === module) {
  runFulfillmentAutomation()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      printExecutiveSummary(result);
    })
    .catch((error) => {
      console.error("Fulfillment automation run failed.");
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runFulfillmentAutomation,
};
