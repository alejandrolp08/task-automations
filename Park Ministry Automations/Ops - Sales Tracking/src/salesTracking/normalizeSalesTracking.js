function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLower(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeVenue(value) {
  return normalizeLower(value)
    .replace(/\bparking lots?\b/g, " ")
    .replace(/\bparking\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " ")
    .replace(/\barena\b/g, " ")
    .replace(/\bstadium\b/g, " ")
    .replace(/\bcenter\b/g, " ")
    .replace(/\bpavilion\b/g, " ")
    .replace(/\blive\b/g, " ")
    .replace(/\bhall\b/g, " ")
    .replace(/\bgym\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEventName(value) {
  return normalizeLower(value)
    .replace(/\bparking passes only\b/g, " ")
    .replace(/\btickets\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeParkingLocation(value) {
  return normalizeLower(value)
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableTime(value) {
  const text = normalizeLower(value);

  if (!text) {
    return "";
  }

  if (/^\d{2}:\d{2}$/.test(text)) {
    return text;
  }

  const amPmMatch = text.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (!amPmMatch) {
    return text;
  }

  let hours = Number(amPmMatch[1]);
  const minutes = amPmMatch[2];
  const modifier = amPmMatch[3].toLowerCase();

  if (modifier === "pm" && hours !== 12) {
    hours += 12;
  }

  if (modifier === "am" && hours === 12) {
    hours = 0;
  }

  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSaleRecord(record = {}) {
  return {
    ...record,
    order_id: normalizeWhitespace(record.order_id),
    event_name: normalizeWhitespace(record.event_name),
    event_name_normalized: normalizeEventName(record.event_name),
    venue: normalizeWhitespace(record.venue),
    venue_normalized: normalizeVenue(record.venue),
    parking_location: normalizeWhitespace(record.parking_location),
    parking_location_normalized: normalizeParkingLocation(record.parking_location),
    event_date: normalizeWhitespace(record.event_date),
    event_time: normalizeComparableTime(record.event_time),
    qty: Number.isFinite(Number(record.qty)) ? Number(record.qty) : 1,
    sale_value: toNumber(record.sale_value),
  };
}

function normalizeInventoryRecord(record = {}) {
  return {
    ...record,
    record_id: normalizeWhitespace(record.record_id),
    event: normalizeWhitespace(record.event),
    event_name_normalized: normalizeEventName(record.event),
    venue: normalizeWhitespace(record.venue),
    venue_normalized: normalizeVenue(record.venue),
    parking_location: normalizeWhitespace(record.parking_location),
    parking_location_normalized: normalizeParkingLocation(record.parking_location),
    event_date: normalizeWhitespace(record.event_date),
    event_time: normalizeComparableTime(record.event_time),
    sell_price: toNumber(record.sell_price),
    buy_cost: toNumber(record.buy_cost),
    purchase_sort_value: normalizeWhitespace(record.purchase_sort_value),
  };
}

module.exports = {
  normalizeComparableTime,
  normalizeEventName,
  normalizeInventoryRecord,
  normalizeParkingLocation,
  normalizeSaleRecord,
  normalizeVenue,
  normalizeWhitespace,
  toNumber,
};
