const { INVENTORY_SMARTSUITE } = require("../../../Shared/src/shared/smartsuite/config");
const {
  normalizeComparableTime,
  normalizeWhitespace,
  toNumber,
} = require("./normalizeSalesTracking");

function getFieldValue(record, fieldId) {
  if (record && record.fields && Object.prototype.hasOwnProperty.call(record.fields, fieldId)) {
    return record.fields[fieldId];
  }

  if (record && Object.prototype.hasOwnProperty.call(record, fieldId)) {
    return record[fieldId];
  }

  return "";
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
  return unwrapped === null || unwrapped === undefined ? "" : String(unwrapped);
}

function normalizeDateValue(value) {
  const text = normalizeWhitespace(toText(value));
  if (!text) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseFullEventInfo(fullEventInfo) {
  const parts = String(fullEventInfo || "")
    .split("|")
    .map((part) => normalizeWhitespace(part));

  return {
    performer: parts[0] || "",
    venue: parts[1] || "",
    parkingLocation: parts[2] || "",
    date: parts[3] || "",
    time: parts[4] || "",
    buyCost: parts[5] || "",
  };
}

function normalizeSoldValue(value) {
  const text = normalizeWhitespace(toText(value)).toLowerCase();
  if (!text) {
    return "";
  }

  if (["yes", "true", "sold"].includes(text)) {
    return "yes";
  }

  if (["no", "false", "backlog", "available"].includes(text)) {
    return "no";
  }

  return text;
}

function normalizeSmartsuiteSaleInventoryRecord(record) {
  const fields = INVENTORY_SMARTSUITE.fields;
  const fullEventInfo = toText(getFieldValue(record, fields.fullEventInfo));
  const parsedFullInfo = parseFullEventInfo(fullEventInfo);

  const performerName = toText(getFieldValue(record, fields.performerName)) || parsedFullInfo.performer;
  const venueName = toText(getFieldValue(record, fields.venueName)) || parsedFullInfo.venue;
  const parkingLocation = toText(getFieldValue(record, fields.parkingLocation)) || parsedFullInfo.parkingLocation;
  const eventDate = normalizeDateValue(getFieldValue(record, fields.eventDate));
  const eventTime = normalizeComparableTime(toText(getFieldValue(record, fields.eventTime)) || parsedFullInfo.time);

  return {
    record_id: toText(record.record_id || record.id),
    event: performerName,
    venue: venueName,
    parking_location: parkingLocation,
    event_date: eventDate,
    event_time: eventTime,
    buy_cost: toNumber(getFieldValue(record, fields.buyCost) || parsedFullInfo.buyCost),
    sell_price: toNumber(getFieldValue(record, fields.sellPrice)),
    total_value: toNumber(getFieldValue(record, fields.totalPayout)),
    profit: toNumber(getFieldValue(record, fields.profit)),
    sold_status: normalizeSoldValue(getFieldValue(record, fields.sold)),
    external_order_number: normalizeWhitespace(toText(getFieldValue(record, fields.externalOrderNumber))),
    full_event_info: fullEventInfo,
    purchase_sort_value: normalizeWhitespace(toText(getFieldValue(record, fields.firstCreated))),
    raw_record: record,
  };
}

function isEligibleUnsoldInventory(record) {
  const soldStatus = String(record.sold_status || "").toLowerCase();
  const hasExternalOrder = Boolean(String(record.external_order_number || "").trim());

  return !hasExternalOrder && soldStatus !== "yes" && soldStatus !== "sold";
}

module.exports = {
  normalizeSmartsuiteSaleInventoryRecord,
  isEligibleUnsoldInventory,
  parseFullEventInfo,
};
