const { SMARTSUITE } = require('../smartsuite/config');
const { normalizeProviderKey } = require('../providers/normalizeProviderKey');

function getFieldValue(record, fieldId, fallbackKey) {
  if (record && record.fields && Object.prototype.hasOwnProperty.call(record.fields, fieldId)) {
    return record.fields[fieldId];
  }

  if (record && Object.prototype.hasOwnProperty.call(record, fieldId)) {
    return record[fieldId];
  }

  if (fallbackKey && Object.prototype.hasOwnProperty.call(record, fallbackKey)) {
    return record[fallbackKey];
  }

  return '';
}

function unwrapValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '';
    }

    return unwrapValue(value[0]);
  }

  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'title')) {
      return value.title;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'label')) {
      return value.label;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      return value.value;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'date')) {
      return value.date;
    }
  }

  return value;
}

function normalizeDateValue(value) {
  const unwrapped = unwrapValue(value);

  if (!unwrapped) {
    return '';
  }

  const text = String(unwrapped);

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeTimeValue(value) {
  const unwrapped = unwrapValue(value);

  if (!unwrapped) {
    return '';
  }

  const text = String(unwrapped).trim();

  if (/^\d{2}:\d{2}$/.test(text)) {
    return text;
  }

  if (/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(text)) {
    const [timePart, modifierPart] = text.toUpperCase().split(/\s+/);
    const [rawHours, minutes] = timePart.split(':');
    let hours = Number(rawHours);
    const modifier = modifierPart;

    if (modifier === 'PM' && hours !== 12) {
      hours += 12;
    }

    if (modifier === 'AM' && hours === 12) {
      hours = 0;
    }

    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  return text;
}

function toText(value) {
  const unwrapped = unwrapValue(value);
  return unwrapped === null || unwrapped === undefined ? '' : String(unwrapped);
}

function toNumber(value) {
  const parsed = Number(unwrapValue(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function unwrapFirstLinkedRecord(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const linkedRecord = unwrapFirstLinkedRecord(item);
      if (linkedRecord) {
        return linkedRecord;
      }
    }
    return null;
  }

  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "id")) {
    return value;
  }

  return null;
}

function normalizeBuyingRecord(record) {
  const fields = SMARTSUITE.fields;
  const venueValue = getFieldValue(record, fields.venueName, "venue");
  const parkingLocationValue = getFieldValue(record, fields.parkingLocation, "parking_location");
  const venueLinkedRecord = unwrapFirstLinkedRecord(venueValue);
  const parkingLocationLinkedRecord = unwrapFirstLinkedRecord(parkingLocationValue);

  return {
    record_id: record.record_id || record.id || '',
    event_id: toText(getFieldValue(record, fields.eventId, 'event_id')),
    event: toText(getFieldValue(record, fields.performerName, 'event')),
    venue: toText(venueValue),
    venue_record_id: toText(venueLinkedRecord?.id || ''),
    event_date: normalizeDateValue(getFieldValue(record, fields.eventDate, 'event_date')),
    event_time: normalizeTimeValue(getFieldValue(record, fields.eventTime, 'event_time')),
    provider: toText(getFieldValue(record, fields.provider, 'provider')),
    provider_key: normalizeProviderKey(toText(getFieldValue(record, fields.provider, 'provider'))),
    parking_location: toText(parkingLocationValue),
    parking_location_record_id: toText(parkingLocationLinkedRecord?.id || ''),
    parking_location_id: toText(getFieldValue(record, fields.parkingLocationId, 'parking_location_id')),
    city_state: toText(getFieldValue(record, fields.cityState, 'city_state')),
    buy_cost: toNumber(getFieldValue(record, fields.buyCost, 'buy_cost')),
    sell_price: toNumber(getFieldValue(record, fields.sellPrice, 'sell_price')),
    reservation_id: toText(getFieldValue(record, fields.reservationId, 'reservation_id')),
    reservation_url: toText(getFieldValue(record, fields.reservationUrl, 'reservation_url')),
    live: unwrapValue(getFieldValue(record, fields.live, 'live')),
  };
}

function normalizeBuyingRecords(records) {
  return records.map(normalizeBuyingRecord);
}

module.exports = { normalizeBuyingRecord, normalizeBuyingRecords };
