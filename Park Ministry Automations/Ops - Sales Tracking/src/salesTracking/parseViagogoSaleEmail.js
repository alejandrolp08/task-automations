const { normalizeComparableTime, toNumber } = require("./normalizeSalesTracking");

function extractMatch(pattern, text) {
  const match = String(text || "").match(pattern);
  return match ? String(match[1] || "").trim() : "";
}

function parseLongDateToIso(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function parseViagogoSaleEmail(emailText) {
  const text = String(emailText || "");
  const eventName =
    extractMatch(/Sale Info\s+([\s\S]*?)\n(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),/i, text) ||
    extractMatch(/You sold \d+ ticket\(s\) for ([\s\S]*?) - Order#/i, text);
  const dateTimeMatch = text.match(
    /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+\|\s+([0-9]{1,2}:[0-9]{2})/i,
  );
  const venue = extractMatch(
    /\n(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),[^\n]*\n([^\n]+)\nOrderID\s*#/i,
    text,
  );
  const orderId = extractMatch(/OrderID\s*#\s*([0-9]+)/i, text) || extractMatch(/Order#\s*([0-9]+)/i, text);
  const qtyText = extractMatch(/\n([0-9]+)\s+Ticket\(s\)\s*\n/i, text);
  const parkingLocation = extractMatch(/Section:\s*([^\n\r]+)/i, text);
  const rowSeats = extractMatch(/Row\s*\|\s*Seat\(s\)\s*([^\n\r]+)/i, text);
  const paymentTotal = extractMatch(/Payment Total\s+\$([0-9,]+(?:\.[0-9]{2})?)/i, text);
  const buyerName = extractMatch(/Full Name:\s*([^\n\r]+)/i, text);
  const buyerEmail = extractMatch(/Email Address:\s*([^\n\r]+)/i, text);
  const deliveryDeadline = extractMatch(/Make sure you can upload them by ([^\n\r]+)/i, text);

  const qty = Number.parseInt(qtyText, 10);
  const saleValue = toNumber(paymentTotal);

  return {
    success: Boolean(eventName && dateTimeMatch && venue && parkingLocation && orderId && qty && saleValue !== null),
    source: "viagogo_stubhub",
    exchange: "StubHub",
    order_id: orderId,
    event_name: eventName,
    event_date: dateTimeMatch ? parseLongDateToIso(dateTimeMatch[2]) : "",
    event_time: dateTimeMatch ? normalizeComparableTime(dateTimeMatch[3]) : "",
    venue,
    parking_location: parkingLocation,
    row_seats: rowSeats,
    qty: Number.isFinite(qty) ? qty : 0,
    sale_value: saleValue,
    buyer_name: buyerName,
    buyer_email: buyerEmail,
    delivery_deadline_raw: deliveryDeadline,
    raw_email: text,
  };
}

module.exports = {
  parseLongDateToIso,
  parseViagogoSaleEmail,
};
