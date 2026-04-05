const fs = require("fs/promises");
const path = require("path");

const {
  SMARTSUITE_API_BASE_URL,
  getSmartsuiteHeaders,
  listSmartsuiteRecords,
  INVENTORY_SMARTSUITE,
} = require("../../../Shared/src/shared/smartsuite/api");

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

function asText(value) {
  if (value == null) {
    return "";
  }

  if (Array.isArray(value)) {
    return asText(value[0]);
  }

  if (typeof value === "object") {
    if (typeof value.title === "string") {
      return value.title.trim();
    }

    if (typeof value.label === "string") {
      return value.label.trim();
    }

    if (typeof value.value === "string") {
      return value.value.trim();
    }

    if (typeof value.url === "string") {
      return value.url.trim();
    }
  }

  return String(value).trim();
}

function normalizeFileName(name, fallback = "smartsuite-attachment.pdf") {
  const cleanName = String(name || "").trim();

  if (!cleanName) {
    return fallback;
  }

  return cleanName.replace(/[^\w.-]+/g, "_");
}

function extractAttachmentCandidate(value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractAttachmentCandidate(item);
      if (candidate?.url) {
        return candidate;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const directUrl =
    value.url ||
    value.download_url ||
    value.downloadUrl ||
    value.signed_url ||
    value.signedUrl ||
    value.public_url ||
    value.publicUrl ||
    value.file_url ||
    value.fileUrl;

  if (typeof directUrl === "string" && directUrl.trim()) {
    return {
      url: directUrl.trim(),
      name:
        value.name ||
        value.filename ||
        value.file_name ||
        value.title ||
        "smartsuite-attachment.pdf",
    };
  }

  const nestedKeys = ["file", "attachment", "attachments", "files"];

  for (const key of nestedKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const candidate = extractAttachmentCandidate(value[key]);
      if (candidate?.url) {
        return candidate;
      }
    }
  }

  return null;
}

function buildSmartsuiteFulfillmentConfig() {
  return {
    tableId: String(
      process.env.SMARTSUITE_INVENTORY_TABLE_ID || INVENTORY_SMARTSUITE.applicationId || "",
    ).trim(),
    pdfFieldId: String(process.env.SMARTSUITE_FULFILLMENT_PDF_FIELD_ID || "").trim(),
    transferProofFieldId: String(
      process.env.SMARTSUITE_FULFILLMENT_TRANSFER_PROOF_FIELD_ID || "",
    ).trim(),
    invoiceIdFieldId: String(process.env.SMARTSUITE_FULFILLMENT_INVOICE_ID_FIELD_ID || "").trim(),
    marketplaceSaleIdFieldId: String(
      process.env.SMARTSUITE_FULFILLMENT_MARKETPLACE_SALE_ID_FIELD_ID || "",
    ).trim(),
    externalOrderFieldId: String(
      process.env.SMARTSUITE_FULFILLMENT_EXTERNAL_ORDER_FIELD_ID || "",
    ).trim(),
    providerFieldId: String(process.env.SMARTSUITE_FULFILLMENT_PROVIDER_FIELD_ID || "").trim(),
  };
}

async function fetchSmartsuiteRecordById(recordId, tableId) {
  const headers = getSmartsuiteHeaders();
  const response = await fetch(
    `${SMARTSUITE_API_BASE_URL}/applications/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}/`,
    {
      method: "GET",
      headers,
    },
  );

  if (response.ok) {
    return response.json();
  }

  if (response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`SmartSuite record fetch failed (${response.status}): ${errorText}`);
  }

  return null;
}

async function findSmartsuiteRecord(input, config = buildSmartsuiteFulfillmentConfig()) {
  if (!config.tableId) {
    throw new Error("Missing SmartSuite inventory table configuration.");
  }

  const recordId = String(input.smartsuiteRecordId || "").trim();
  if (recordId) {
    const directRecord = await fetchSmartsuiteRecordById(recordId, config.tableId);
    if (directRecord) {
      return directRecord;
    }
  }

  const externalOrderNumber = String(input.externalOrderNumber || "").trim();

  if (externalOrderNumber && config.externalOrderFieldId) {
    const matches = await listSmartsuiteRecords(config.tableId, {
      limit: 100,
      filter: {
        operator: "and",
        fields: [
          {
            field: config.externalOrderFieldId,
            comparison: "is",
            value: externalOrderNumber,
          },
        ],
      },
    });

    return matches[0] || null;
  }

  return null;
}

async function downloadAttachment(url, targetPath) {
  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SmartSuite attachment download failed (${response.status}): ${errorText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, bytes);
  return targetPath;
}

async function getSharedFileUrl(handle) {
  const cleanHandle = String(handle || "").trim();

  if (!cleanHandle) {
    return "";
  }

  const response = await fetch(
    `${SMARTSUITE_API_BASE_URL}/shared-files/${encodeURIComponent(cleanHandle)}/url/`,
    {
      method: "GET",
      headers: getSmartsuiteHeaders(),
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`SmartSuite shared file URL lookup failed (${response.status}): ${text}`);
  }

  const payload = text ? JSON.parse(text) : {};
  return String(payload.url || "").trim();
}

async function resolveFulfillmentInputFromSmartsuite(
  input,
  { downloadsDir } = {},
) {
  const config = buildSmartsuiteFulfillmentConfig();
  const record = await findSmartsuiteRecord(input, config);

  if (!record) {
    throw new Error("No SmartSuite record matched the provided fulfillment input.");
  }

  const pdfAttachment = extractAttachmentCandidate(getFieldValue(record, config.pdfFieldId));
  const transferProofAttachment = extractAttachmentCandidate(
    getFieldValue(record, config.transferProofFieldId),
  );

  const pdfName = normalizeFileName(pdfAttachment?.name, "smartsuite-ticket.pdf");
  const transferProofName = normalizeFileName(
    transferProofAttachment?.name,
    "smartsuite-transfer-proof.pdf",
  );

  const resolved = {
    ...input,
    provider: input.provider || asText(getFieldValue(record, config.providerFieldId)) || "stubhub",
    invoiceId: input.invoiceId || asText(getFieldValue(record, config.invoiceIdFieldId)),
    marketplaceSaleId:
      input.marketplaceSaleId || asText(getFieldValue(record, config.marketplaceSaleIdFieldId)),
    externalOrderNumber:
      input.externalOrderNumber || asText(getFieldValue(record, config.externalOrderFieldId)),
    pdfUrl: input.pdfUrl || pdfAttachment?.url || "",
    pdfName: input.pdfName || pdfName,
    transferProofUrl: input.transferProofUrl || transferProofAttachment?.url || "",
    smartsuite: {
      tableId: config.tableId,
      recordId: asText(record.record_id || record.id),
      pdfFieldId: config.pdfFieldId,
      transferProofFieldId: config.transferProofFieldId,
      rawRecord: record,
    },
  };

  if (!input.pdfPath && resolved.pdfUrl && downloadsDir) {
    resolved.pdfPath = path.join(downloadsDir, pdfName);
    await downloadAttachment(resolved.pdfUrl, resolved.pdfPath);
  }

  if (!input.transferProofPath && resolved.transferProofUrl && downloadsDir) {
    resolved.transferProofPath = path.join(downloadsDir, transferProofName);
    await downloadAttachment(resolved.transferProofUrl, resolved.transferProofPath);
  }

  return resolved;
}

module.exports = {
  buildSmartsuiteFulfillmentConfig,
  downloadAttachment,
  extractAttachmentCandidate,
  findSmartsuiteRecord,
  getSharedFileUrl,
  getFieldValue,
  resolveFulfillmentInputFromSmartsuite,
};
