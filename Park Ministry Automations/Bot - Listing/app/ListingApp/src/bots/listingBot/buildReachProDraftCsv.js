function escapeCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows, columns) {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(column.getter(row))).join(","));
  return `${[header, ...body].join("\n")}\n`;
}

function formatPurchaseDate(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const rawHours = date.getHours();
  const suffix = rawHours >= 12 ? "PM" : "AM";
  const hours = rawHours % 12 || 12;

  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds} ${suffix}`;
}

function parseEventDateTime(row) {
  const eventDate = String(row.event_date || "").trim();
  if (!eventDate) {
    return null;
  }

  const [year, month, day] = eventDate.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const resolvedTime = String(row.resolved_event_time || row.event_time || "").trim();
  let hours = 0;
  let minutes = 0;

  if (/^\d{2}:\d{2}$/.test(resolvedTime)) {
    const [parsedHours, parsedMinutes] = resolvedTime.split(":").map(Number);
    hours = parsedHours;
    minutes = parsedMinutes;
  }

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function buildInHandAt(row) {
  const eventDateTime = parseEventDateTime(row);
  if (!eventDateTime) {
    return "";
  }

  const inHandAt = new Date(eventDateTime.getTime() - 24 * 60 * 60 * 1000);
  const month = String(inHandAt.getMonth() + 1).padStart(2, "0");
  const day = String(inHandAt.getDate()).padStart(2, "0");
  const year = inHandAt.getFullYear();
  return `${month}/${day}/${year}`;
}

function extractParkingLocationNote(parkingLocation) {
  const text = String(parkingLocation || "").trim();
  if (!text) {
    return "";
  }

  const match = text.match(/\(([^()]*)\)\s*$/);
  if (match) {
    return String(match[1] || "").trim();
  }

  return text;
}

function normalizeListingNote(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\bstaidum\b/g, "stadium")
    .replace(/\bstadum\b/g, "stadium")
    .replace(/\bmilse\b/g, "miles")
    .replace(/\bmiels\b/g, "miles")
    .trim();

  return normalized.replace(/(^|\s)\.(\d)/g, "$10.$2");
}

function buildListingNotes(row) {
  return normalizeListingNote(extractParkingLocationNote(row.parking_location));
}

function buildPrivateNotes(row) {
  return "";
}

function getMarketplaceFeePercent() {
  const parsed = Number(process.env.LISTING_MARKETPLACE_FEE_PERCENT);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 100) {
    return 9;
  }
  return parsed;
}

function calculateExpectedValue(sellPrice, feePercent = getMarketplaceFeePercent()) {
  const amount = Number(sellPrice);
  if (!Number.isFinite(amount)) {
    return "";
  }

  const payout = amount * ((100 - feePercent) / 100);
  return payout.toFixed(2);
}

function buildReachProDraftCsv(rows, { generatedAt = new Date() } = {}) {
  const purchaseDate = formatPurchaseDate(generatedAt);
  const marketplaceFeePercent = getMarketplaceFeePercent();

  const columns = [
    { header: "VendorOrderId", getter: (row) => row.reservation_id || "" },
    { header: "VendorName", getter: () => "Default Vendor" },
    { header: "VendorEmailAddress", getter: () => "null@null.com" },
    { header: "PurchaseDate", getter: () => purchaseDate },
    { header: "DeliveryType", getter: () => "PDF" },
    { header: "TicketCount", getter: () => 1 },
    { header: "CurrencyCode", getter: () => "USD" },
    { header: "InHandAt", getter: (row) => buildInHandAt(row) },
    { header: "Section", getter: (row) => row.parking_location || "" },
    { header: "Row", getter: () => "" },
    { header: "SeatFrom", getter: () => "" },
    { header: "SeatTo", getter: () => "" },
    { header: "StubHubEventId", getter: (row) => row.resolved_event_id || row.event_id || "" },
    { header: "UnitCost", getter: (row) => row.buy_cost ?? "" },
    { header: "FaceValueCost", getter: () => "" },
    { header: "ExpectedValue", getter: (row) => calculateExpectedValue(row.sell_price, marketplaceFeePercent) },
    { header: "TaxPaid", getter: () => "" },
    { header: "AutoBroadcastCreatedListing", getter: () => "TRUE" },
    { header: "ListingNotes", getter: (row) => buildListingNotes(row) },
    { header: "PrivateNotes", getter: (row) => buildPrivateNotes(row) },
  ];

  return toCsv(rows, columns);
}

module.exports = { buildReachProDraftCsv, formatPurchaseDate, calculateExpectedValue, getMarketplaceFeePercent };
