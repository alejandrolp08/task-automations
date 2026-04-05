const { listSmartsuiteRecords } = require("../../../Shared/src/shared/smartsuite/api");
const { INVENTORY_SMARTSUITE } = require("../../../Shared/src/shared/smartsuite/config");
const { getSharedFileUrl } = require("./smartsuiteFulfillmentSource");
const { containsAutomationNote } = require("./fulfillmentAutomationNotes");
const {
  inferProviderKeyFromReservationUrl,
  normalizeProviderKey,
} = require("./providerDetection");

function getConfiguredFieldId(envKey, fallback = "") {
  return String(process.env[envKey] || fallback || "").trim();
}

function getFieldValue(record, fieldId) {
  if (!fieldId) {
    return undefined;
  }

  if (record && record.fields && Object.prototype.hasOwnProperty.call(record.fields, fieldId)) {
    const nestedValue = record.fields[fieldId];

    if (Array.isArray(nestedValue) && nestedValue.length > 0) {
      return nestedValue;
    }

    if (nestedValue && typeof nestedValue === "object") {
      return nestedValue;
    }

    if (typeof nestedValue === "string" && nestedValue.trim()) {
      return nestedValue;
    }
  }

  if (record && Object.prototype.hasOwnProperty.call(record, fieldId)) {
    return record[fieldId];
  }

  return undefined;
}

function unwrapValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "";
    }

    return unwrapValue(value[0]);
  }

  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "title")) {
      return value.title;
    }

    if (Object.prototype.hasOwnProperty.call(value, "label")) {
      return value.label;
    }

    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return value.value;
    }

    if (Object.prototype.hasOwnProperty.call(value, "date")) {
      return value.date;
    }
  }

  return value;
}

function toText(value) {
  const unwrapped = unwrapValue(value);
  return unwrapped == null ? "" : String(unwrapped).trim();
}

function normalizeBooleanLike(value) {
  const text = toText(value).toLowerCase();

  if (!text) {
    return "";
  }

  if (["yes", "true", "fulfilled", "done", "sent"].includes(text)) {
    return "yes";
  }

  if (["no", "false", "backlog", "pending", "open", "unfulfilled"].includes(text)) {
    return "no";
  }

  return text;
}

function normalizeDateValue(value) {
  const text = toText(value);

  if (!text) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function getFulfillmentStartDate() {
  const override = String(process.env.FULFILLMENT_START_DATE || "").trim();

  if (override) {
    return override;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
}

function extractAttachmentCandidate(value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractAttachmentCandidate(item);
      if (candidate?.url || candidate?.handle) {
        return candidate;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  if (value.handle && value.metadata && typeof value.metadata === "object") {
    return {
      url: "",
      handle: String(value.handle).trim(),
      key: String(value.metadata.key || "").trim(),
      name: String(value.metadata.filename || value.name || "attachment.pdf").trim(),
      mimeType: String(value.metadata.mimetype || "").trim(),
      size: Number(value.metadata.size || 0) || 0,
    };
  }

  const url =
    value.url ||
    value.download_url ||
    value.downloadUrl ||
    value.signed_url ||
    value.signedUrl ||
    value.public_url ||
    value.publicUrl ||
    value.file_url ||
    value.fileUrl;

  if (typeof url === "string" && url.trim()) {
    return {
      url: url.trim(),
      name: String(
        value.name || value.filename || value.file_name || value.title || "attachment.pdf",
      ).trim(),
      handle: String(value.handle || "").trim(),
      key: String(value?.metadata?.key || "").trim(),
      mimeType: String(value?.metadata?.mimetype || "").trim(),
      size: Number(value?.metadata?.size || 0) || 0,
    };
  }

  for (const key of ["file", "attachment", "attachments", "files"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const candidate = extractAttachmentCandidate(value[key]);
      if (candidate?.url || candidate?.handle) {
        return candidate;
      }
    }
  }

  return null;
}

function buildFulfillmentFieldMap() {
  return {
    eventDate: INVENTORY_SMARTSUITE.fields.eventDate,
    sold: INVENTORY_SMARTSUITE.fields.sold,
    externalOrderNumber: INVENTORY_SMARTSUITE.fields.externalOrderNumber,
    fullEventInfo: INVENTORY_SMARTSUITE.fields.fullEventInfo,
    fulfilled: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_FULFILLED_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.fulfilled,
    ),
    pdf: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_PDF_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.pdf,
    ),
    pdfChecker: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_PDF_CHECKER_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.pdfChecker,
    ),
    reservationId: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_RESERVATION_ID_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.reservationId,
    ),
    reservationUrl: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_RESERVATION_URL_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.reservationUrl,
    ),
    requestForSolution: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_REQUEST_FOR_SOLUTION_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.requestForSolution,
    ),
    provider: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_PROVIDER_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.provider,
    ),
    invoiceId: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_INVOICE_ID_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.invoiceId,
    ),
    marketplaceSaleId: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_MARKETPLACE_SALE_ID_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.externalOrderNumber,
    ),
    requestCommentDetail: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_COMMENT_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.requestCommentDetail,
    ),
    resolutionOverride: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_RESOLUTION_OVERRIDE_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.resolutionOverride,
    ),
  };
}

function buildFulfillmentPrefilter(fieldMap = buildFulfillmentFieldMap()) {
  const startDate = getFulfillmentStartDate();
  const fields = [];

  if (fieldMap.eventDate) {
    fields.push({
      field: fieldMap.eventDate,
      comparison: "is_on_or_after",
      value: {
        date_mode: "exact_date",
        date_mode_value: startDate,
      },
    });
  }

  if (fieldMap.marketplaceSaleId) {
    fields.push({
      field: fieldMap.marketplaceSaleId,
      comparison: "is_not_empty",
      value: "",
    });
  }

  if (fieldMap.pdfChecker) {
    fields.push({
      field: fieldMap.pdfChecker,
      comparison: "is",
      value: "PDF ATTACHED",
    });
  }

  if (fieldMap.requestForSolution) {
    fields.push({
      field: fieldMap.requestForSolution,
      comparison: "is",
      value: false,
    });
  }

  return {
    operator: "and",
    fields,
  };
}

function normalizeFulfillmentCandidate(record, fieldMap = buildFulfillmentFieldMap()) {
  const pdfAttachment = extractAttachmentCandidate(getFieldValue(record, fieldMap.pdf));
  const providerName = toText(getFieldValue(record, fieldMap.provider));
  const reservationUrl = toText(getFieldValue(record, fieldMap.reservationUrl));
  const providerKey = normalizeProviderKey(providerName);
  const inferredProvider = inferProviderKeyFromReservationUrl(reservationUrl);
  const effectiveProvider = providerKey !== "unknown" ? providerKey : inferredProvider;

  return {
    record_id: toText(record.record_id || record.id),
    event_date: normalizeDateValue(getFieldValue(record, fieldMap.eventDate)),
    full_event_info: toText(getFieldValue(record, fieldMap.fullEventInfo)),
    sold_status: normalizeBooleanLike(getFieldValue(record, fieldMap.sold)),
    fulfilled_status: normalizeBooleanLike(getFieldValue(record, fieldMap.fulfilled)),
    pdf_checker: toText(getFieldValue(record, fieldMap.pdfChecker)),
    reservation_id: toText(getFieldValue(record, fieldMap.reservationId)),
    request_for_solution: normalizeBooleanLike(getFieldValue(record, fieldMap.requestForSolution)),
    provider: providerName,
    provider_name: providerName,
    provider_key: providerKey,
    inferred_provider: inferredProvider,
    effective_provider: effectiveProvider,
    invoice_id: toText(getFieldValue(record, fieldMap.invoiceId)),
    marketplace_sale_id: toText(getFieldValue(record, fieldMap.marketplaceSaleId)),
    external_order_number: toText(getFieldValue(record, fieldMap.externalOrderNumber)),
    reservation_url: reservationUrl,
    request_comment_detail: toText(getFieldValue(record, fieldMap.requestCommentDetail)),
    resolution_override: toText(getFieldValue(record, fieldMap.resolutionOverride)),
    pdf_url: pdfAttachment?.url || "",
    pdf_name: pdfAttachment?.name || "",
    pdf_handle: pdfAttachment?.handle || "",
    pdf_key: pdfAttachment?.key || "",
    pdf_mime_type: pdfAttachment?.mimeType || "",
    pdf_size: pdfAttachment?.size || 0,
    raw_record: record,
  };
}

function isEligibleFulfillmentCandidate(candidate) {
  const startDate = getFulfillmentStartDate();
  const sold = candidate.sold_status === "yes" || candidate.sold_status === "sold";
  const notFulfilled = !candidate.fulfilled_status || candidate.fulfilled_status === "no";
  const pdfChecker = String(candidate.pdf_checker || "").trim().toUpperCase();
  const hasPdf = pdfChecker === "PDF ATTACHED";
  const hasSaleReference = Boolean(candidate.invoice_id || candidate.marketplace_sale_id);
  const resolutionOverrideAccepted =
    !candidate.resolution_override ||
    candidate.resolution_override.toUpperCase() === "N/A";
  const isOnOrAfterStartDate =
    Boolean(candidate.event_date) && String(candidate.event_date) >= String(startDate);
  const requestForSolutionOpen = candidate.request_for_solution === "yes";
  const hasAutomationComment = containsAutomationNote(candidate.request_comment_detail);

  return (
    sold &&
    notFulfilled &&
    hasPdf &&
    hasSaleReference &&
    resolutionOverrideAccepted &&
    isOnOrAfterStartDate &&
    !requestForSolutionOpen &&
    !hasAutomationComment
  );
}

function chooseBetterCandidate(current, next) {
  if (!current) {
    return next;
  }

  const currentDate = String(current.event_date || "");
  const nextDate = String(next.event_date || "");

  if (nextDate > currentDate) {
    return next;
  }

  if (nextDate < currentDate) {
    return current;
  }

  const currentPdfChecker = String(current.pdf_checker || "").trim().toUpperCase();
  const nextPdfChecker = String(next.pdf_checker || "").trim().toUpperCase();

  if (nextPdfChecker === "PDF ATTACHED" && currentPdfChecker !== "PDF ATTACHED") {
    return next;
  }

  if (currentPdfChecker === "PDF ATTACHED" && nextPdfChecker !== "PDF ATTACHED") {
    return current;
  }

  return current;
}

function dedupeFulfillmentCandidates(records) {
  const bySaleId = new Map();

  for (const record of records) {
    const key = String(record.marketplace_sale_id || "").trim();

    if (!key) {
      continue;
    }

    bySaleId.set(key, chooseBetterCandidate(bySaleId.get(key), record));
  }

  return Array.from(bySaleId.values());
}

function compareFulfillmentCandidatesByEventDate(a, b) {
  const aDate = String(a?.event_date || "");
  const bDate = String(b?.event_date || "");

  if (aDate && bDate && aDate !== bDate) {
    return aDate.localeCompare(bDate);
  }

  const aSale = String(a?.marketplace_sale_id || "");
  const bSale = String(b?.marketplace_sale_id || "");

  if (aSale !== bSale) {
    return aSale.localeCompare(bSale);
  }

  return String(a?.record_id || "").localeCompare(String(b?.record_id || ""));
}

async function fetchFulfillmentCandidates() {
  const tableId =
    process.env.SMARTSUITE_INVENTORY_TABLE_ID || INVENTORY_SMARTSUITE.applicationId;
  const fieldMap = buildFulfillmentFieldMap();
  const prefilter = buildFulfillmentPrefilter(fieldMap);
  const rawRecords = await listSmartsuiteRecords(tableId, {
    limit: 500,
    filter: prefilter,
  });
  const normalizedRecords = rawRecords.map((record) =>
    normalizeFulfillmentCandidate(record, fieldMap),
  );

  const dedupedRecords = dedupeFulfillmentCandidates(normalizedRecords);
  return {
    table_id: tableId,
    field_map: fieldMap,
    prefilter,
    raw_records: rawRecords,
    normalized_records: normalizedRecords,
    deduped_records: dedupedRecords,
    start_date: getFulfillmentStartDate(),
    eligible_records: dedupedRecords
      .filter(isEligibleFulfillmentCandidate)
      .sort(compareFulfillmentCandidatesByEventDate),
  };
}

async function verifyFulfillmentCandidatePdf(candidate) {
  const fileHandle = String(candidate?.pdf_handle || "").trim();

  if (!fileHandle) {
    return {
      ok: false,
      verified: false,
      reason: "missing_pdf_handle",
      shared_file_url: "",
    };
  }

  try {
    const sharedFileUrl = await getSharedFileUrl(fileHandle);

    return {
      ok: Boolean(sharedFileUrl),
      verified: Boolean(sharedFileUrl),
      reason: sharedFileUrl ? "shared_file_url_resolved" : "shared_file_url_empty",
      shared_file_url: sharedFileUrl,
    };
  } catch (error) {
    return {
      ok: false,
      verified: false,
      reason: "shared_file_lookup_failed",
      error: error.message,
      shared_file_url: "",
    };
  }
}

module.exports = {
  buildFulfillmentPrefilter,
  buildFulfillmentFieldMap,
  extractAttachmentCandidate,
  fetchFulfillmentCandidates,
  isEligibleFulfillmentCandidate,
  normalizeFulfillmentCandidate,
  verifyFulfillmentCandidatePdf,
  dedupeFulfillmentCandidates,
  compareFulfillmentCandidatesByEventDate,
};
