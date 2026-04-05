function normalizeFulfillmentRecord(record) {
  const raw = record || {};
  const marketplace = raw.marketplace == null ? "StubHub" : String(raw.marketplace).trim();
  const normalizedMarketplace = marketplace.toLowerCase();
  const fallbackProvider = normalizedMarketplace.includes("stubhub") ? "stubhub" : "";
  const pdfEntries = Array.isArray(raw.pdfEntries)
    ? raw.pdfEntries.map((entry) => ({
        pdfPath: entry?.pdfPath == null ? "" : String(entry.pdfPath).trim(),
        pdfName: entry?.pdfName == null ? "" : String(entry.pdfName).trim(),
        ticketIds: Array.isArray(entry?.ticketIds)
          ? entry.ticketIds
              .map((value) => String(value == null ? "" : value).trim())
              .filter(Boolean)
          : [],
      }))
    : [];
  const ticketIds = Array.isArray(raw.ticketIds)
    ? raw.ticketIds
    : raw.ticketId == null || raw.ticketId === ""
      ? []
      : [raw.ticketId];

  return {
    provider: String(raw.provider || fallbackProvider).trim().toLowerCase(),
    saleId: raw.saleId == null ? "" : String(raw.saleId).trim(),
    invoiceId: raw.invoiceId == null ? "" : String(raw.invoiceId).trim(),
    marketplaceSaleId:
      raw.marketplaceSaleId == null ? "" : String(raw.marketplaceSaleId).trim(),
    marketplace,
    smartsuiteRecordId:
      raw.smartsuiteRecordId == null ? "" : String(raw.smartsuiteRecordId).trim(),
    useSmartsuiteSource:
      raw.useSmartsuiteSource == null ? false : Boolean(raw.useSmartsuiteSource),
    externalOrderNumber: raw.externalOrderNumber == null ? "" : String(raw.externalOrderNumber).trim(),
    pdfPath: raw.pdfPath == null ? "" : String(raw.pdfPath).trim(),
    pdfUrl: raw.pdfUrl == null ? "" : String(raw.pdfUrl).trim(),
    pdfName: raw.pdfName == null ? "" : String(raw.pdfName).trim(),
    pdfEntries,
    transferProofPath:
      raw.transferProofPath == null ? "" : String(raw.transferProofPath).trim(),
    transferProofUrl:
      raw.transferProofUrl == null ? "" : String(raw.transferProofUrl).trim(),
    ticketIds: ticketIds
      .map((value) => String(value == null ? "" : value).trim())
      .filter(Boolean),
    quantity: Number.isFinite(Number(raw.quantity)) ? Number(raw.quantity) : 0,
    eventName: raw.eventName == null ? "" : String(raw.eventName).trim(),
    eventDate: raw.eventDate == null ? "" : String(raw.eventDate).trim(),
    internalNotes: raw.internalNotes == null ? "" : String(raw.internalNotes).trim(),
    paymentReferenceNumber:
      raw.paymentReferenceNumber == null ? "" : String(raw.paymentReferenceNumber).trim(),
    autoFulfill: raw.autoFulfill == null ? true : Boolean(raw.autoFulfill),
    notes: raw.notes == null ? "" : String(raw.notes).trim(),
    raw,
  };
}

module.exports = {
  normalizeFulfillmentRecord,
};
