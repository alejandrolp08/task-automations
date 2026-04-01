const fs = require("fs/promises");
const path = require("path");

const STUBHUB_POS_API_BASE = "https://pointofsaleapi.stubhub.net";

function getStubhubApiBase() {
  return STUBHUB_POS_API_BASE;
}

function buildStubhubInvoiceUrl(invoiceId) {
  const cleanInvoiceId = String(invoiceId || "").trim();
  return `${getStubhubApiBase()}/invoices/${encodeURIComponent(cleanInvoiceId)}`;
}

function buildStubhubInvoiceByMarketplaceSaleUrl(marketplaceSaleId, marketplace = "StubHub") {
  const cleanMarketplaceSaleId = String(marketplaceSaleId || "").trim();
  const cleanMarketplace = String(marketplace || "StubHub").trim();

  return `${getStubhubApiBase()}/invoices/${encodeURIComponent(cleanMarketplaceSaleId)}/${encodeURIComponent(cleanMarketplace)}`;
}

function buildStubhubInvoiceAssetsUrl(invoiceId) {
  const cleanInvoiceId = String(invoiceId || "").trim();
  return `${buildStubhubInvoiceUrl(cleanInvoiceId)}/assets`;
}

function buildStubhubInvoiceSearchUrl() {
  return `${getStubhubApiBase()}/invoices/search`;
}

function buildStubhubHeaders({ token, accountId, contentType = "application/json" } = {}) {
  const cleanToken = String(token || "").trim();
  const cleanAccountId = String(accountId || "").trim();

  if (!cleanToken) {
    throw new Error("Missing StubHub POS bearer token.");
  }

  if (!cleanAccountId) {
    throw new Error("Missing StubHub POS Account-Id.");
  }

  return {
    Authorization: `Bearer ${cleanToken}`,
    "Account-Id": cleanAccountId,
    Accept: "application/json",
    "Content-Type": contentType,
  };
}

async function readFileAsBase64(filePath) {
  const absolutePath = path.resolve(filePath);
  const buffer = await fs.readFile(absolutePath);
  return buffer.toString("base64");
}

async function buildUserDocumentFileRequest(filePath, options = {}) {
  const absolutePath = path.resolve(filePath);
  const content = await readFileAsBase64(absolutePath);

  return {
    name: options.name || path.basename(absolutePath),
    content,
    contentType: options.contentType || "application/pdf",
  };
}

async function buildStubhubEticketUploadRequests({
  pdfPath,
  pdfName,
  ticketIds = [],
} = {}) {
  if (!pdfPath) {
    return [];
  }

  const file = await buildUserDocumentFileRequest(pdfPath, {
    name: pdfName || undefined,
    contentType: "application/pdf",
  });

  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    return [{ file }];
  }

  return ticketIds.map((ticketId) => ({
    file,
    ticketId: Number.isFinite(Number(ticketId)) ? Number(ticketId) : ticketId,
  }));
}

async function buildStubhubTransferProofUploadRequest({
  transferProofPath,
  transferProofName,
} = {}) {
  if (!transferProofPath) {
    return null;
  }

  return {
    file: await buildUserDocumentFileRequest(transferProofPath, {
      name: transferProofName || undefined,
      contentType: "application/pdf",
    }),
  };
}

async function buildStubhubSaleUpdateRequest(record) {
  const pdfEntries = Array.isArray(record.pdfEntries) && record.pdfEntries.length
    ? record.pdfEntries
    : [
        {
          pdfPath: record.pdfPath,
          pdfName: record.pdfName,
          ticketIds: record.ticketIds,
        },
      ];
  const eTicketGroups = await Promise.all(
    pdfEntries.map((entry) =>
      buildStubhubEticketUploadRequests({
        pdfPath: entry.pdfPath,
        pdfName: entry.pdfName,
        ticketIds: entry.ticketIds,
      }),
    ),
  );
  const eTickets = eTicketGroups.flat();
  const transferProofUploadRequest = await buildStubhubTransferProofUploadRequest({
    transferProofPath: record.transferProofPath,
  });

  return {
    internalNotes: record.internalNotes || record.notes || null,
    paymentReferenceNumber: record.paymentReferenceNumber || null,
    eTickets: eTickets.length ? eTickets : null,
    transferProofUploadRequest,
    transferProofUrls: record.transferProofUrl ? [record.transferProofUrl] : null,
    autoFulfill: record.autoFulfill,
  };
}

module.exports = {
  STUBHUB_POS_API_BASE,
  buildStubhubEticketUploadRequests,
  buildStubhubHeaders,
  buildStubhubInvoiceAssetsUrl,
  buildStubhubInvoiceByMarketplaceSaleUrl,
  buildStubhubInvoiceSearchUrl,
  buildStubhubInvoiceUrl,
  buildStubhubSaleUpdateRequest,
  buildStubhubTransferProofUploadRequest,
  buildUserDocumentFileRequest,
  getStubhubApiBase,
};
